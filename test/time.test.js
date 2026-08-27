import assert from 'node:assert/strict';
import test from 'node:test';
import { waitUntil } from '../src/time.js';

test('espera exactamente hasta el instante indicado', async () => {
  let slept = null;
  const delay = await waitUntil(15_000, {
    now: () => 10_000,
    sleep: async milliseconds => {
      slept = milliseconds;
    },
  });

  assert.equal(delay, 5_000);
  assert.equal(slept, 5_000);
});

test('no espera si la apertura ya pasó', async () => {
  let called = false;
  const delay = await waitUntil(5_000, {
    now: () => 10_000,
    sleep: async () => {
      called = true;
    },
  });

  assert.equal(delay, 0);
  assert.equal(called, false);
});

test('rechaza esperas superiores a una hora', async () => {
  await assert.rejects(
    () => waitUntil(3_600_001, { now: () => 0, sleep: async () => {} }),
    /supera el máximo/
  );
});
