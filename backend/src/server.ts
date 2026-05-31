import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config';
import { getDb, closeDb } from './db';
import { healthRoutes } from './routes/health';

async function main(): Promise<void> {
  // Open DB + run migrations before serving any traffic.
  getDb();

  const app = Fastify({ logger: true });

  // Consistent error envelope: { error: { code, message } } (spec §0).
  app.setErrorHandler((err, _req, reply) => {
    const status = err.statusCode ?? 500;
    reply.status(status).send({
      error: {
        code: err.code ?? (status >= 500 ? 'INTERNAL' : 'BAD_REQUEST'),
        message: status >= 500 ? 'Internal server error' : err.message,
      },
    });
  });
  app.setNotFoundHandler((req, reply) => {
    // Unknown API routes -> JSON 404; non-API -> SPA fallback (if static is enabled).
    if (req.url.startsWith('/api/')) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      return;
    }
    if (config.staticDir) {
      reply.sendFile('index.html');
      return;
    }
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  await app.register(healthRoutes);

  // Serve the built frontend from the same origin (no CORS). Optional in dev.
  if (config.staticDir && fs.existsSync(config.staticDir)) {
    await app.register(fastifyStatic, {
      root: path.resolve(config.staticDir),
      index: ['index.html'],
    });
    app.log.info(`Serving static frontend from ${config.staticDir}`);
  } else {
    app.log.warn('STATIC_DIR not set or missing — API only (no frontend served)');
  }

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
