import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { buildBackupPath, performBackup, MAX_BACKUPS } from './backup';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homecal-backup-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('buildBackupPath produces a timestamped filename in the data dir', () => {
  const p = buildBackupPath('/data');
  assert.ok(p.startsWith('/data/backup-'));
  assert.ok(p.endsWith('.db'));
  assert.match(path.basename(p), /^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.db$/);
});

test('performBackup creates a valid standalone SQLite file', () => {
  const srcPath = path.join(tmpDir, 'calendar.db');
  const src = new Database(srcPath);
  src.pragma('journal_mode = WAL');
  src.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
  src.exec('INSERT INTO test VALUES (1), (2), (3)');

  const destPath = performBackup(src, tmpDir);
  assert.ok(fs.existsSync(destPath));
  assert.ok(fs.statSync(destPath).size > 0);

  const dest = new Database(destPath, { readonly: true });
  const rows = dest.prepare('SELECT count(*) as n FROM test').get() as { n: number };
  assert.equal(rows.n, 3);
  dest.close();

  src.close();
});

test('performBackup prunes old backups beyond MAX_BACKUPS', () => {
  const srcPath = path.join(tmpDir, 'calendar.db');
  const src = new Database(srcPath);
  src.pragma('journal_mode = WAL');
  src.exec('CREATE TABLE t (id INTEGER)');

  for (let i = 0; i < MAX_BACKUPS + 3; i++) {
    const name = `backup-2026-01-${String(i + 1).padStart(2, '0')}T00-00-00Z.db`;
    fs.writeFileSync(path.join(tmpDir, name), 'placeholder');
  }

  performBackup(src, tmpDir);

  const backups = fs.readdirSync(tmpDir).filter((f) => f.startsWith('backup-') && f.endsWith('.db'));
  assert.ok(backups.length <= MAX_BACKUPS, `expected <= ${MAX_BACKUPS}, got ${backups.length}`);

  src.close();
});
