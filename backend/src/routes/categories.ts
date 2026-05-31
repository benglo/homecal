import type { FastifyInstance } from 'fastify';
import { categoryCreate, categoryUpdate } from '../schemas';
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '../repos/categories';
import { parseBody } from './helpers';

export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/categories', async () => listCategories());

  app.post('/api/categories', async (req, reply) => {
    const cat = createCategory(parseBody(categoryCreate, req.body));
    reply.status(201);
    return cat;
  });

  app.put<{ Params: { id: string } }>('/api/categories/:id', async (req) =>
    updateCategory(req.params.id, parseBody(categoryUpdate, req.body))
  );

  app.delete<{ Params: { id: string } }>('/api/categories/:id', async (req, reply) => {
    deleteCategory(req.params.id);
    reply.status(204);
  });
}
