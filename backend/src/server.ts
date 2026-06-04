import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config';
import { getDb, closeDb } from './db';
import { healthRoutes } from './routes/health';
import { categoryRoutes } from './routes/categories';
import { eventRoutes } from './routes/events';
import { dinnerRoutes } from './routes/dinners';
import { streamRoutes, drainSSE } from './routes/stream';
import { backupRoutes } from './routes/backup';
import { feedRoutes } from './routes/feed';
import { photoRoutes } from './routes/photos';
import { kioskRoutes } from './routes/kiosk';
import { weatherRoutes } from './routes/weather';
import { familyMemberRoutes } from './routes/familyMembers';
import { choreRoutes } from './routes/chores';
import { voiceRoutes } from './routes/voice';
import { initPhotos, purgeTrash } from './photos';
import { getCachedWeather } from './weather';

async function main(): Promise<void> {
  // Open DB + run migrations before serving any traffic.
  getDb();

  // Ensure photo directories exist and purge stale trash.
  initPhotos(config.photosDir);
  purgeTrash(path.join(config.photosDir, '.trash'), 7);

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'warn' : 'info') },
  });

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
  await app.register(categoryRoutes);
  await app.register(eventRoutes);
  await app.register(dinnerRoutes);
  await app.register(streamRoutes);
  await app.register(backupRoutes);
  await app.register(feedRoutes);
  await app.register(photoRoutes);
  await app.register(kioskRoutes);
  await app.register(weatherRoutes);
  await app.register(familyMemberRoutes);
  await app.register(choreRoutes);
  await app.register(voiceRoutes);

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
    drainSSE();
    await app.close();
    closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.port, host: config.host });

  getCachedWeather(config.bomStationCode, config.bomStationId, config.weatherCacheTtlMs, app.log)
    .catch(() => { /* warm-cache attempt — failure is fine, first request will retry */ });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
