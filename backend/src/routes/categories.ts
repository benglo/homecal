import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { categoryCreate, categoryUpdate } from '../schemas';
import {
  createCategory,
  deleteCategory,
  listCategories,
  reassignEvents,
  updateCategory,
} from '../repos/categories';
import { broker } from '../realtime';
import { parseBody } from './helpers';
import { registerCrud } from './crud';

const reassignBody = z.object({ toId: z.string().min(1) });

export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  registerCrud(app, {
    prefix: '/api/categories',
    channel: 'categories',
    create: categoryCreate,
    update: categoryUpdate,
    repo: {
      list: listCategories,
      create: createCategory,
      update: updateCategory,
      // deleteCategory throws 409 CATEGORY_IN_USE when referenced; that
      // propagates through Fastify's error handler — no bespoke handler needed.
      remove: deleteCategory,
    },
  });

  app.post<{ Params: { id: string } }>('/api/categories/:id/reassign', async (req) => {
    const { toId } = parseBody(reassignBody, req.body);
    const moved = reassignEvents(req.params.id, toId);
    broker.poke('events');
    return { moved };
  });
}
