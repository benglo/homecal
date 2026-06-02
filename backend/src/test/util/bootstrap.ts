/** Shared bootstrap for route-level tests.
 *
 *  Why this exists: every route test file needs to (a) point the DB at a fresh
 *  tmpdir before the db/config modules are loaded, and (b) stand up a Fastify
 *  app whose error envelope matches production. Repeating those ~30 lines per
 *  file was a maintenance hazard — the error handler in particular drifted out
 *  of sync with the real one in server.ts.
 *
 *  Important caveat: `setupIsolatedDb()` MUST be called at module top level
 *  (before any `import` of a module that reads `process.env.DATA_DIR` at load
 *  time — config.ts, db/index.ts, repos/*). Because ESM hoists static imports,
 *  the calling test file MUST use dynamic `await import(...)` inside before()
 *  to pull in route modules. We can't paper over that here; we can only
 *  document it. See routes/familyMembers.test.ts for the pattern.
 *
 *  node:test on Node 20 runs all *.test.ts in a single process; the db/config
 *  modules are module-cached, so whichever test file imports them first wins
 *  the DATA_DIR. That's intentional — don't `closeDb()` or `rmSync(tmpDir)` in
 *  teardown; the OS reclaims /tmp. */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';

/** Create an isolated DB directory and set `process.env.DATA_DIR` before any
 *  db/config module is imported. Returns the path. Call at module top level. */
export function setupIsolatedDb(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `homecal-${prefix}-`));
  process.env.DATA_DIR = dir;
  return dir;
}

type RouteFactory = (app: FastifyInstance) => Promise<void> | void;

/** Build a Fastify app whose error envelope mirrors server.ts (spec §0:
 *  `{ error: { code, message } }`). Registers the given route factories and
 *  awaits `ready()`. */
export async function createTestApp(...routeFactories: RouteFactory[]): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Mirror server.ts. Keep these two handlers in sync with the real ones —
  // if the production envelope changes, this file is the single place to
  // update for all route tests.
  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    reply.status(status).send({
      error: {
        code: (err as { code?: string }).code ?? (status >= 500 ? 'INTERNAL' : 'BAD_REQUEST'),
        message: status >= 500 ? 'Internal server error' : err.message,
      },
    });
  });
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  for (const factory of routeFactories) {
    await app.register(factory);
  }
  await app.ready();
  return app;
}
