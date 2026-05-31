import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBroker } from './realtime';

test('subscribers receive pokes in order with kind + timestamp', () => {
  const b = createBroker();
  const got: string[] = [];
  b.subscribe((p) => got.push(p.kind));
  b.poke('events');
  b.poke('dinners');
  assert.deepEqual(got, ['events', 'dinners']);
});

test('poke stamps an ISO-8601 timestamp', () => {
  const b = createBroker();
  let at = '';
  b.subscribe((p) => {
    at = p.at;
  });
  b.poke('categories');
  assert.ok(!Number.isNaN(Date.parse(at)), 'at should parse as a date');
});

test('unsubscribe stops delivery and shrinks the set', () => {
  const b = createBroker();
  const got: string[] = [];
  const off = b.subscribe((p) => got.push(p.kind));
  assert.equal(b.size(), 1);
  off();
  assert.equal(b.size(), 0);
  b.poke('events');
  assert.deepEqual(got, []);
});

test('every subscriber receives each poke', () => {
  const b = createBroker();
  let a = 0;
  let c = 0;
  b.subscribe(() => (a += 1));
  b.subscribe(() => (c += 1));
  b.poke('events');
  assert.equal(a, 1);
  assert.equal(c, 1);
});

test('a throwing subscriber does not block the others', () => {
  const b = createBroker();
  let reached = false;
  b.subscribe(() => {
    throw new Error('broken pipe');
  });
  b.subscribe(() => {
    reached = true;
  });
  b.poke('events');
  assert.equal(reached, true);
});
