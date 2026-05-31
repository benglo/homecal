import fs from 'node:fs';
import Database from 'better-sqlite3';
import { config, dbPath } from '../config';
import { runMigrations } from './migrate';

/**
 * Single, in-process, synchronous SQLite connection (better-sqlite3).
 * Do NOT pool or open per-request — the app's own writes serialize naturally.
 */
let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  // Ensure the data DIRECTORY exists (the bind-mount target).
  fs.mkdirSync(config.dataDir, { recursive: true });

  db = new Database(dbPath);

  // PRAGMAs — every startup. WAL is persistent but set it explicitly + self-document.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON'); // per-connection, OFF by default — the classic footgun
  db.pragma('busy_timeout = 5000');

  // Fail loud at boot if the volume is corrupt, rather than serving garbage.
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') {
    throw new Error(`SQLite integrity_check failed: ${integrity}`);
  }

  runMigrations(db);
  return db;
}

/** Graceful shutdown: checkpoint the WAL so the .db is self-contained for backups. */
export function closeDb(): void {
  if (!db) return;
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
    db = null;
  }
}
