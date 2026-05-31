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
import { parseBody } from './helpers';

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
    reply.status(201);
    return ev;
  });

  app.put<{ Params: { id: string } }>('/api/events/:id', async (req) =>
    updateEvent(req.params.id, parseBody(eventUpdate, req.body))
  );

  app.delete<{ Params: { id: string } }>('/api/events/:id', async (req, reply) => {
    deleteEvent(req.params.id);
    reply.status(204);
  });

  app.delete<{ Params: { id: string; date: string } }>(
    '/api/events/:id/occurrences/:date',
    async (req, reply) => {
      cancelOccurrence(req.params.id, req.params.date);
      reply.status(204);
    }
  );
}
