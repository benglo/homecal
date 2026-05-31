import type { FastifyInstance } from 'fastify';
import { getDb } from '../db';

/**
 * GET /api/health -> { ok, db, version }
 * Includes a cheap SQLite integrity signal so the wall/ops can detect a bad volume.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => {
    const db = getDb();
    const integrity = db.pragma('integrity_check', { simple: true });
    const userVersion = db.pragma('user_version', { simple: true });
    return {
      ok: integrity === 'ok',
      db: integrity,
      schemaVersion: userVersion,
    };
  });
}
