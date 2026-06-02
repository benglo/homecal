import type { FastifyInstance } from 'fastify';
import { choreCreate, choreUpdate, choreCompleteBody, dateParam } from '../schemas';
import {
  listChores,
  getChore,
  createChore,
  updateChore,
  deleteChore,
  completeChore,
  uncompleteChore,
  getBoard,
} from '../repos/chores';
import { httpError } from '../util/errors';
import { broker } from '../realtime';
import { parseBody } from './helpers';
import { todayBrisbane } from '../util/time';

export async function choreRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/chores', async () => listChores());

  app.get<{ Params: { id: string } }>('/api/chores/:id', async (req) => {
    const chore = getChore(req.params.id);
    if (!chore) throw httpError(404, 'NOT_FOUND', 'Chore not found');
    return chore;
  });

  app.post('/api/chores', async (req, reply) => {
    const chore = createChore(parseBody(choreCreate, req.body));
    broker.poke('chores');
    reply.status(201);
    return chore;
  });

  app.put<{ Params: { id: string } }>('/api/chores/:id', async (req) => {
    const chore = updateChore(req.params.id, parseBody(choreUpdate, req.body));
    broker.poke('chores');
    return chore;
  });

  app.delete<{ Params: { id: string } }>('/api/chores/:id', async (req, reply) => {
    deleteChore(req.params.id);
    broker.poke('chores');
    reply.status(204);
  });

  app.get('/api/chore-board', async (req) => {
    const query = (req.query ?? {}) as { date?: string };
    const date = query.date ? parseBody(dateParam, query.date) : todayBrisbane();
    return getBoard(date);
  });

  app.post<{ Params: { id: string } }>('/api/chores/:id/complete', async (req, reply) => {
    const { date } = parseBody(choreCompleteBody, req.body);
    const { completion, created } = completeChore(req.params.id, date);
    broker.poke('chores');
    reply.status(created ? 201 : 200);
    return completion;
  });

  app.delete<{ Params: { id: string; date: string } }>(
    '/api/chores/:id/complete/:date',
    async (req, reply) => {
      const date = parseBody(dateParam, req.params.date);
      uncompleteChore(req.params.id, date);
      broker.poke('chores');
      reply.status(204);
    }
  );
}
