import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceState } from './state';

test('createVoiceState: starts with no heartbeat', () => {
  const s = createVoiceState();
  assert.equal(s.lastHeartbeatAt(), null);
  assert.equal(s.micOnline(new Date('2026-06-04T12:00:00Z')), false);
});

test('createVoiceState: heartbeat within 60s = micOnline', () => {
  const s = createVoiceState();
  const t0 = new Date('2026-06-04T12:00:00Z');
  s.recordHeartbeat(t0);
  assert.equal(s.micOnline(new Date('2026-06-04T12:00:30Z')), true);
  assert.equal(s.micOnline(new Date('2026-06-04T12:01:01Z')), false);
});

test('createVoiceState: heartbeat strips milliseconds to match spec storage format', () => {
  const s = createVoiceState();
  // Pass a Date with explicit milliseconds — the stored ISO must be second-precision.
  s.recordHeartbeat(new Date('2026-06-04T12:00:00.789Z'));
  assert.equal(s.lastHeartbeatAt(), '2026-06-04T12:00:00Z');
  assert.doesNotMatch(s.lastHeartbeatAt() ?? '', /\.\d{3}Z$/);
});

test('createVoiceState: micOnline is exclusive at the 60s boundary', () => {
  const s = createVoiceState();
  const t0 = new Date('2026-06-04T12:00:00Z');
  s.recordHeartbeat(t0);
  // Exactly 60s later: still online (<=)
  assert.equal(s.micOnline(new Date('2026-06-04T12:01:00Z')), true);
  // 60.001s later: offline (>)
  assert.equal(s.micOnline(new Date('2026-06-04T12:01:00.001Z')), false);
});
