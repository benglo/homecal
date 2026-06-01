import http from 'node:http';
import type { FastifyInstance } from 'fastify';
import { config } from '../config';
import { httpError } from '../util/errors';

export async function kioskRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/kiosk/shutdown', async (_req, reply) => {
    if (!config.kioskHost) {
      throw httpError(503, 'KIOSK_NOT_CONFIGURED', 'KIOSK_HOST is not set');
    }

    const url = `http://${config.kioskHost}:${config.kioskPort}/shutdown`;

    const result = await new Promise<number>((resolve, reject) => {
      const req = http.request(url, { method: 'POST', timeout: 5000 }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 500);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    }).catch(() => 0);

    if (result === 0) {
      throw httpError(502, 'KIOSK_UNREACHABLE', 'Could not reach the kiosk');
    }

    return reply.send({ ok: true, message: 'Shutdown signal sent' });
  });
}
