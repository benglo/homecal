import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { setupIsolatedDb, createTestApp } from '../test/util/bootstrap';

// MUST run before any module that reads process.env.DATA_DIR / PI_API_TOKEN at
// load time. See bootstrap.ts for the full rationale.
setupIsolatedDb('voicetest');
process.env.PI_API_TOKEN = 'test-token';

const PI = { 'x-pi-token': 'test-token' };

let app: FastifyInstance;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let broker: any;

before(async () => {
  // Dynamic import: route module transitively loads db/config/voice singletons,
  // which read env at module evaluation. Static `import` would hoist above the
  // setupIsolatedDb()/PI_API_TOKEN assignment above.
  const { voiceRoutes } = await import('./voice');
  ({ broker } = await import('../realtime'));
  app = await createTestApp(voiceRoutes);
});

after(async () => {
  await app.close();
});

interface Envelope {
  error?: { code: string; message: string };
  [k: string]: unknown;
}

test('POST /api/voice/heartbeat: 401 without token', async () => {
  const r = await app.inject({
    method: 'POST',
    url: '/api/voice/heartbeat',
    payload: { at: '2026-06-04T12:00:00Z' },
  });
  assert.equal(r.statusCode, 401);
  const body = r.json() as Envelope;
  assert.equal(body.error?.code, 'UNAUTHORIZED');
});

test('POST /api/voice/heartbeat: records heartbeat + 200, GET status reflects mic_online', async () => {
  // Stamp heartbeat at "now" so micOnline check (within 60s) passes regardless
  // of wall clock drift between this and the status request.
  const at = new Date().toISOString();
  const r = await app.inject({
    method: 'POST',
    url: '/api/voice/heartbeat',
    headers: PI,
    payload: { at },
  });
  assert.equal(r.statusCode, 200);
  const status = await app.inject({ method: 'GET', url: '/api/voice/status' });
  const body = status.json() as { mic_online: boolean; last_heartbeat_at: string | null };
  assert.equal(body.mic_online, true);
  assert.equal(body.last_heartbeat_at, at);
});

test('POST /api/voice/audit: inserts row + 201', async () => {
  const r = await app.inject({
    method: 'POST',
    url: '/api/voice/audit',
    headers: PI,
    payload: {
      id: '0191ec00-0000-7000-8000-000000000001',
      transcript: "tonight's dinner is tacos",
      intent_json: '{"intent":"dinner_set"}',
      confidence: 0.92,
      status: 'applied',
      duration_ms: 4200,
    },
  });
  assert.equal(r.statusCode, 201);
});

test('POST /api/voice/audit: validation 400 on bad status', async () => {
  const r = await app.inject({
    method: 'POST',
    url: '/api/voice/audit',
    headers: PI,
    payload: {
      id: '0191ec00-0000-7000-8000-000000000002',
      transcript: 'x',
      status: 'bogus',
    },
  });
  assert.equal(r.statusCode, 400);
  const body = r.json() as Envelope;
  assert.equal(body.error?.code, 'VALIDATION');
});

test('POST /api/voice/state: pokes broker with payload', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let poked: any = null;
  const unsub = broker.subscribe((p: unknown) => { poked = p; });
  try {
    const r = await app.inject({
      method: 'POST',
      url: '/api/voice/state',
      headers: PI,
      payload: { utterance_id: 'u1', kind: 'listening', payload: { vu: 0.4 } },
    });
    assert.equal(r.statusCode, 200);
    assert.equal(poked?.kind, 'voice');
    assert.deepEqual(poked?.payload, { utterance_id: 'u1', kind: 'listening', payload: { vu: 0.4 } });
  } finally {
    unsub();
  }
});

test('POST /api/voice/state: 401 without pi token', async () => {
  const r = await app.inject({
    method: 'POST',
    url: '/api/voice/state',
    payload: { utterance_id: 'u2', kind: 'idle' },
  });
  assert.equal(r.statusCode, 401);
});

test('PUT /api/voice/mute: stores + GET reflects + pokes broker', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let poked: any = null;
  const unsub = broker.subscribe((p: unknown) => { poked = p; });
  try {
    const r = await app.inject({
      method: 'PUT',
      url: '/api/voice/mute',
      payload: { until: '2026-06-04T19:00:00Z' },
    });
    assert.equal(r.statusCode, 200);
    assert.equal(poked?.kind, 'voice');
    assert.deepEqual(poked?.payload, { kind: 'mute_changed', mute_until: '2026-06-04T19:00:00Z' });

    const status = await app.inject({ method: 'GET', url: '/api/voice/status' });
    const body = status.json() as { mute_until: string | null };
    assert.equal(body.mute_until, '2026-06-04T19:00:00Z');
  } finally {
    unsub();
  }
});

test('PUT /api/voice/mute: null clears mute', async () => {
  const r = await app.inject({
    method: 'PUT',
    url: '/api/voice/mute',
    payload: { until: null },
  });
  assert.equal(r.statusCode, 200);
  const status = await app.inject({ method: 'GET', url: '/api/voice/status' });
  const body = status.json() as { mute_until: string | null; muted: boolean };
  assert.equal(body.mute_until, null);
  assert.equal(body.muted, false);
});
