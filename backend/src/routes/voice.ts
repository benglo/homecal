import type { FastifyInstance } from 'fastify';
import { parseBody } from './helpers';
import {
  voiceStateBody, voiceAuditBody, voiceHeartbeatBody, voiceMuteBody,
} from '../schemas';
import { insertUtterance } from '../repos/voiceUtterances';
import { getMuteUntil, setMuteUntil } from '../repos/voiceSettings';
import { broker } from '../realtime';
import { voiceState } from '../voice/state';
import { requirePiToken } from '../voice/auth';
import { config } from '../config';

export async function voiceRoutes(app: FastifyInstance): Promise<void> {
  const piGuard = requirePiToken(config.piApiToken);

  // Pi -> server: state for SSE fan-out — payload is forwarded to subscribers
  app.post('/api/voice/state', { preHandler: piGuard }, async (req, reply) => {
    const body = parseBody(voiceStateBody, req.body);
    broker.poke('voice', body);
    reply.code(200).send({ ok: true });
  });

  // Pi -> server: audit log
  app.post('/api/voice/audit', { preHandler: piGuard }, async (req, reply) => {
    const body = parseBody(voiceAuditBody, req.body);
    insertUtterance({
      id: body.id,
      transcript: body.transcript,
      intentJson: body.intent_json ?? null,
      confidence: body.confidence ?? null,
      status: body.status,
      durationMs: body.duration_ms ?? null,
      error: body.error ?? null,
      source: body.source ?? null,
    });
    reply.code(201).send({ ok: true });
  });

  // Pi -> server: heartbeat
  app.post('/api/voice/heartbeat', { preHandler: piGuard }, async (req, reply) => {
    const body = parseBody(voiceHeartbeatBody, req.body);
    voiceState.recordHeartbeat(new Date(body.at));
    reply.code(200).send({ ok: true });
  });

  // Wall / phone -> server: liveness + mute state
  app.get('/api/voice/status', async () => {
    const now = new Date();
    const mu = getMuteUntil();
    return {
      mic_online: voiceState.micOnline(now),
      last_heartbeat_at: voiceState.lastHeartbeatAt(),
      mute_until: mu,
      muted: !!mu && new Date(mu).getTime() > now.getTime(),
    };
  });

  // Wall / phone -> server: mute toggle
  app.put('/api/voice/mute', async (req) => {
    const body = parseBody(voiceMuteBody, req.body);
    setMuteUntil(body.until);
    broker.poke('voice', { kind: 'mute_changed', mute_until: body.until });
    return { ok: true, mute_until: body.until };
  });
}
