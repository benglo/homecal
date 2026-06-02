import type { FastifyInstance } from 'fastify';
import { eventCreate, eventUpdate, windowQuery } from '../schemas';
import {
  cancelOccurrence,
  createEvent,
  deleteEvent,
  getEventMaster,
  listOccurrences,
  updateEvent,
} from '../repos/events';
import { httpError } from '../util/errors';
import { broker } from '../realtime';
import { parseBody } from './helpers';

// Events don't use registerCrud: GET /api/events takes a required {start,end}
// window (it returns expanded occurrences, not masters), so it isn't the
// "no-arg list" shape the helper assumes. Migrating POST/PUT/DELETE alone
// would add more wiring than it removes — kept bespoke for clarity.
export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/events', async (req) => {
    const { start, end } = parseBody(windowQuery, req.query);
    return listOccurrences(start, end);
  });

  app.get<{ Params: { id: string } }>('/api/events/:id', async (req) => {
    const master = getEventMaster(req.params.id);
    if (!master) throw httpError(404, 'NOT_FOUND', 'Event not found');
    return master;
  });

  app.post('/api/events', async (req, reply) => {
    const ev = createEvent(parseBody(eventCreate, req.body));
    broker.poke('events');
    reply.status(201);
    return ev;
  });

  app.put<{ Params: { id: string } }>('/api/events/:id', async (req) => {
    const ev = updateEvent(req.params.id, parseBody(eventUpdate, req.body));
    broker.poke('events');
    return ev;
  });

  app.delete<{ Params: { id: string } }>('/api/events/:id', async (req, reply) => {
    deleteEvent(req.params.id);
    broker.poke('events');
    reply.status(204);
  });

  app.delete<{ Params: { id: string; date: string } }>(
    '/api/events/:id/occurrences/:date',
    async (req, reply) => {
      cancelOccurrence(req.params.id, req.params.date);
      broker.poke('events');
      reply.status(204);
    }
  );
}
