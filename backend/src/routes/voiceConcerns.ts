import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db';

const querySchema = z.object({
  since: z.string().datetime().optional(),
});

interface ConcernRow {
  id: string;
  createdAt: string;
  transcript: string;
  answer: string | null;
  intentName: string | null;
}

export async function voiceConcernsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/voice/concerns', async (req, reply) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'BAD_QUERY', message: parsed.error.message },
      });
    }
    const since = parsed.data.since
      ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const rows = getDb().prepare(`
      SELECT id, created_at AS createdAt, transcript, answer,
             intent_name AS intentName
      FROM voice_utterances
      WHERE concern = 1 AND created_at >= ?
      ORDER BY created_at DESC
    `).all(since) as ConcernRow[];
    return rows;
  });
}
