import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dateParam, dinnerUpsert, suggestionsQuery } from '../schemas';
import { deleteDinner, listDinners, listSuggestions, setDinner } from '../repos/dinners';
import { broker } from '../realtime';
import { parseBody } from './helpers';

const dinnerWindow = z.object({
  start: dateParam,
  end: dateParam,
});

export async function dinnerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/dinners/suggestions', async (req) => {
    const { limit } = parseBody(suggestionsQuery, req.query);
    return listSuggestions(limit);
  });

  app.get('/api/dinners', async (req) => {
    const { start, end } = parseBody(dinnerWindow, req.query);
    return listDinners(start, end);
  });

  app.put<{ Params: { date: string } }>('/api/dinners/:date', async (req) => {
    const date = parseBody(dateParam, req.params.date);
    const { meal } = parseBody(dinnerUpsert, req.body);
    const dinner = setDinner(date, meal);
    broker.poke('dinners');
    return dinner;
  });

  app.delete<{ Params: { date: string } }>('/api/dinners/:date', async (req, reply) => {
    deleteDinner(parseBody(dateParam, req.params.date));
    broker.poke('dinners');
    reply.status(204);
  });
}
