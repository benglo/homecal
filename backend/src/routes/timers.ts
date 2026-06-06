import type { FastifyInstance } from 'fastify';
import { timerCreate, timerExtend } from '../schemas';
import {
  acknowledgeTimer,
  cancelTimer,
  createTimer,
  extendTimer,
  listActiveTimers,
} from '../repos/timers';
import { broker } from '../realtime';
import { parseBody } from './helpers';

export async function timerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/timers', async () => listActiveTimers());

  app.post('/api/timers', async (req, reply) => {
    const body = parseBody(timerCreate, req.body);
    const timer = createTimer({
      label: body.label ?? null,
      durationSec: body.durationSec,
    });
    broker.poke('timers');
    reply.status(201);
    return timer;
  });

  app.patch<{ Params: { id: string } }>('/api/timers/:id', async (req) => {
    const { addSec } = parseBody(timerExtend, req.body);
    const timer = extendTimer(req.params.id, addSec);
    broker.poke('timers');
    return timer;
  });

  app.delete<{ Params: { id: string } }>('/api/timers/:id', async (req, reply) => {
    cancelTimer(req.params.id);
    broker.poke('timers');
    reply.status(204);
  });

  app.post<{ Params: { id: string } }>('/api/timers/:id/acknowledge', async (req) => {
    const timer = acknowledgeTimer(req.params.id);
    broker.poke('timers');
    return timer;
  });
}
