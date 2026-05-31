import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { broker } from '../realtime';

const sseConnections = new Set<ServerResponse>();

export function drainSSE(): void {
  for (const res of sseConnections) {
    try {
      res.end();
    } catch {
      /* already gone */
    }
  }
  sseConnections.clear();
}

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/stream', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    res.write(': connected\n\n');

    sseConnections.add(res);

    const unsubscribe = broker.subscribe((poke) => {
      res.write(`event: poke\ndata: ${JSON.stringify(poke)}\n\n`);
    });

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 25_000);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      unsubscribe();
      sseConnections.delete(res);
    };
    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);
  });
}
