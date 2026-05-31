import type { FastifyInstance } from 'fastify';
import { broker } from '../realtime';

/** Server-Sent Events: clients open `/api/stream` and refetch on every poke.
 *  We hijack the raw socket (Fastify won't manage the lifecycle of a long-lived
 *  stream) and write text/event-stream frames by hand. A 25s heartbeat keeps
 *  intermediaries from idling the connection out; the client reconnects natively. */
export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/stream', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable proxy buffering so pokes flush immediately
    });
    res.write('retry: 3000\n\n'); // client backoff hint
    res.write(': connected\n\n');

    const unsubscribe = broker.subscribe((poke) => {
      res.write(`event: poke\ndata: ${JSON.stringify(poke)}\n\n`);
    });

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 25_000);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return; // a disconnect can emit both 'error' and 'close'
      cleaned = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);
  });
}
