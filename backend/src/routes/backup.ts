import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { config } from '../config';

export const MAX_BACKUPS = 10;

export function buildBackupPath(dataDir: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
  return path.join(dataDir, `backup-${ts}.db`);
}

export function performBackup(db: Database.Database, dataDir: string): string {
  const dest = buildBackupPath(dataDir);
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  pruneOldBackups(dataDir);
  return dest;
}

function pruneOldBackups(dataDir: string): void {
  const backups = fs
    .readdirSync(dataDir)
    .filter((f) => f.startsWith('backup-') && f.endsWith('.db'))
    .sort();

  while (backups.length > MAX_BACKUPS) {
    const oldest = backups.shift()!;
    try {
      fs.unlinkSync(path.join(dataDir, oldest));
    } catch {
      /* best-effort cleanup */
    }
  }
}

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/backup', async () => {
    const db = getDb();
    const dest = performBackup(db, config.dataDir);
    const stat = fs.statSync(dest);
    return {
      ok: true,
      file: path.basename(dest),
      sizeBytes: stat.size,
    };
  });
}
