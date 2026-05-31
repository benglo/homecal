import type { FastifyInstance } from 'fastify';
import { categoryCreate, categoryUpdate } from '../schemas';
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '../repos/categories';
import { broker } from '../realtime';
import { parseBody } from './helpers';

export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/categories', async () => listCategories());

  app.post('/api/categories', async (req, reply) => {
    const cat = createCategory(parseBody(categoryCreate, req.body));
    broker.poke('categories');
    reply.status(201);
    return cat;
  });

  app.put<{ Params: { id: string } }>('/api/categories/:id', async (req) => {
    const cat = updateCategory(req.params.id, parseBody(categoryUpdate, req.body));
    broker.poke('categories');
    return cat;
  });

  app.delete<{ Params: { id: string } }>('/api/categories/:id', async (req, reply) => {
    deleteCategory(req.params.id);
    broker.poke('categories');
    reply.status(204);
  });
}
