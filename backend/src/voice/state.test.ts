import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceState } from './state';

test('createVoiceState: starts with no heartbeat and no mute', () => {
  const s = createVoiceState();
  assert.equal(s.lastHeartbeatAt(), null);
  assert.equal(s.muteUntil(), null);
  assert.equal(s.isMuted(new Date('2026-06-04T12:00:00Z')), false);
  assert.equal(s.micOnline(new Date('2026-06-04T12:00:00Z')), false);
});

test('createVoiceState: heartbeat within 60s = micOnline', () => {
  const s = createVoiceState();
  const t0 = new Date('2026-06-04T12:00:00Z');
  s.recordHeartbeat(t0);
  assert.equal(s.micOnline(new Date('2026-06-04T12:00:30Z')), true);
  assert.equal(s.micOnline(new Date('2026-06-04T12:01:01Z')), false);
});

test('createVoiceState: setMuteUntil + isMuted', () => {
  const s = createVoiceState();
  s.setMuteUntil('2026-06-04T19:00:00Z');
  assert.equal(s.isMuted(new Date('2026-06-04T18:00:00Z')), true);
  assert.equal(s.isMuted(new Date('2026-06-04T20:00:00Z')), false);
  s.setMuteUntil(null);
  assert.equal(s.isMuted(new Date('2026-06-04T18:00:00Z')), false);
});
