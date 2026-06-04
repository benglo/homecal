import type { FastifyRequest, FastifyReply } from 'fastify';

export function requirePiToken(token: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!token) {
      reply.code(503).send({ error: { code: 'VOICE_DISABLED', message: 'PI_API_TOKEN not configured' } });
      return;
    }
    const provided = req.headers['x-pi-token'];
    if (provided !== token) {
      reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'invalid pi token' } });
      return;
    }
  };
}
