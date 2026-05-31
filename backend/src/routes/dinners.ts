import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dateParam, dinnerUpsert } from '../schemas';
import { deleteDinner, listDinners, setDinner } from '../repos/dinners';
import { parseBody } from './helpers';

const dinnerWindow = z.object({
  start: dateParam,
  end: dateParam,
});

export async function dinnerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/dinners', async (req) => {
    const { start, end } = parseBody(dinnerWindow, req.query);
    return listDinners(start, end);
  });

  app.put<{ Params: { date: string } }>('/api/dinners/:date', async (req) => {
    const date = parseBody(dateParam, req.params.date);
    const { meal } = parseBody(dinnerUpsert, req.body);
    return setDinner(date, meal);
  });

  app.delete<{ Params: { date: string } }>('/api/dinners/:date', async (req, reply) => {
    deleteDinner(parseBody(dateParam, req.params.date));
    reply.status(204);
  });
}
