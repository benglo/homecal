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
  const expectedStored = at.replace(/\.\d{3}Z$/, 'Z'); // storage strips millis (spec §0)
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
  assert.equal(body.last_heartbeat_at, expectedStored);
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
      source: 'matcher',
    },
  });
  assert.equal(r.statusCode, 201);
});

test('POST /api/voice/audit: validation 400 on bad source', async () => {
  const r = await app.inject({
    method: 'POST',
    url: '/api/voice/audit',
    headers: PI,
    payload: {
      id: '0191ec00-0000-7000-8000-000000000004',
      transcript: 'x',
      status: 'applied',
      source: 'guessed',
    },
  });
  assert.equal(r.statusCode, 400);
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

test('GET /api/voice/status returns last_tts_provider=null when no utterances', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/voice/status' });
  assert.equal(r.statusCode, 200);
  const body = r.json() as { last_tts_provider: string | null };
  assert.equal(body.last_tts_provider, null);
});

test('GET /api/voice/status includes last_tts_provider from most recent utterance', async () => {
  const { insertUtterance } = await import('../repos/voiceUtterances');
  insertUtterance({
    id: 'u1',
    transcript: 'x',
    status: 'applied',
    intentJson: null,
    confidence: null,
    durationMs: null,
    error: null,
    source: null,
    ttsProvider: 'kokoro_lan',
  });
  const r = await app.inject({ method: 'GET', url: '/api/voice/status' });
  assert.equal(r.statusCode, 200);
  const body = r.json() as { last_tts_provider: string | null };
  assert.equal(body.last_tts_provider, 'kokoro_lan');
});

test('GET /api/voice/status: volume defaults to 60, audio_muted false', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/voice/status' });
  const body = r.json() as { volume: number; audio_muted: boolean };
  assert.equal(body.volume, 60);
  assert.equal(body.audio_muted, false);
});

test('PUT /api/voice/volume: stores + GET reflects + pokes broker', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let poked: any = null;
  const unsub = broker.subscribe((p: unknown) => { poked = p; });
  try {
    const r = await app.inject({
      method: 'PUT',
      url: '/api/voice/volume',
      payload: { level: 35 },
    });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json(), { ok: true, volume: 35 });
    assert.equal(poked?.kind, 'voice');
    assert.deepEqual(poked?.payload, { kind: 'volume_changed' });

    const status = await app.inject({ method: 'GET', url: '/api/voice/status' });
    const body = status.json() as { volume: number };
    assert.equal(body.volume, 35);
  } finally {
    unsub();
  }
});

test('PUT /api/voice/volume: validation 400 on out-of-range', async () => {
  const r = await app.inject({
    method: 'PUT',
    url: '/api/voice/volume',
    payload: { level: 150 },
  });
  assert.equal(r.statusCode, 400);
  const body = r.json() as Envelope;
  assert.equal(body.error?.code, 'VALIDATION');
});

test('PUT /api/voice/volume: validation 400 on non-integer', async () => {
  const r = await app.inject({
    method: 'PUT',
    url: '/api/voice/volume',
    payload: { level: 42.5 },
  });
  assert.equal(r.statusCode, 400);
});

test('PUT /api/voice/audio-mute: stores + GET reflects + pokes broker', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let poked: any = null;
  const unsub = broker.subscribe((p: unknown) => { poked = p; });
  try {
    const r = await app.inject({
      method: 'PUT',
      url: '/api/voice/audio-mute',
      payload: { muted: true },
    });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json(), { ok: true, audio_muted: true });
    assert.equal(poked?.kind, 'voice');
    assert.deepEqual(poked?.payload, { kind: 'audio_mute_changed' });

    const status = await app.inject({ method: 'GET', url: '/api/voice/status' });
    const body = status.json() as { audio_muted: boolean };
    assert.equal(body.audio_muted, true);
  } finally {
    unsub();
  }
});

test('setVolume clamps out-of-range values (repo belt-and-braces)', async () => {
  const { setVolume, getVolume } = await import('../repos/voiceSettings');
  setVolume(999);
  assert.equal(getVolume(), 100);
  setVolume(-5);
  assert.equal(getVolume(), 0);
  setVolume(50); // restore a sane value
});

// NO PI token header — the wall (browser, no token) calls this, mirroring the
// unguarded PUT /api/voice/mute. The test must exercise the unauthenticated path.
test('POST /api/voice/listen: pokes voice listen_request + 200 (no token)', async () => {
  const seen: unknown[] = [];
  const off = broker.subscribe((p: { kind: string; payload?: unknown }) => {
    if (p.kind === 'voice') seen.push(p.payload);
  });
  const r = await app.inject({ method: 'POST', url: '/api/voice/listen' });
  off();
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { ok: true });
  assert.deepEqual(seen, [{ kind: 'listen_request' }]);
});
