import type { FastifyInstance } from 'fastify';
import { familyMemberCreate, familyMemberUpdate } from '../schemas';
import {
  createFamilyMember,
  deleteFamilyMember,
  listFamilyMembers,
  updateFamilyMember,
} from '../repos/familyMembers';
import { registerCrud } from './crud';

export async function familyMemberRoutes(app: FastifyInstance): Promise<void> {
  registerCrud(app, {
    prefix: '/api/family-members',
    channel: 'family-members',
    create: familyMemberCreate,
    update: familyMemberUpdate,
    repo: {
      list: listFamilyMembers,
      create: createFamilyMember,
      update: updateFamilyMember,
      remove: deleteFamilyMember,
    },
  });
}
