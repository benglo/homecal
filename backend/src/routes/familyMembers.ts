import type { FastifyInstance } from 'fastify';
import { familyMemberCreate, familyMemberUpdate } from '../schemas';
import {
  createFamilyMember,
  deleteFamilyMember,
  listFamilyMembers,
  updateFamilyMember,
} from '../repos/familyMembers';
import { broker } from '../realtime';
import { parseBody } from './helpers';

export async function familyMemberRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/family-members', async () => listFamilyMembers());

  app.post('/api/family-members', async (req, reply) => {
    const member = createFamilyMember(parseBody(familyMemberCreate, req.body));
    broker.poke('family-members');
    reply.status(201);
    return member;
  });

  app.put<{ Params: { id: string } }>('/api/family-members/:id', async (req) => {
    const member = updateFamilyMember(req.params.id, parseBody(familyMemberUpdate, req.body));
    broker.poke('family-members');
    return member;
  });

  app.delete<{ Params: { id: string } }>('/api/family-members/:id', async (req, reply) => {
    deleteFamilyMember(req.params.id);
    broker.poke('family-members');
    reply.status(204);
  });
}
