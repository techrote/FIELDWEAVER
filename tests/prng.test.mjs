import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Xoshiro128StarStar, deriveSeed } from '../src/core/index.js';

const EXPECTED_VECTOR = [1157361581, 1849995165, 947661637, 1672453563, 3575711744, 4109442462, 1740981171, 435890908, 15586571, 2797456083];

test('xoshiro128** produces the checked-in FW-002 test vector', () => {
  const rng = Xoshiro128StarStar.fromSeed(0x12345678, 0x42);
  const actual = Array.from({ length: 10 }, () => rng.nextUint32());
  assert.deepEqual(actual, EXPECTED_VECTOR);
});

test('stable substream seed derivation depends on IDs, not call history', () => {
  const a1 = deriveSeed(99, 17, 3);
  deriveSeed(99, 999, 888, 777);
  const a2 = deriveSeed(99, 17, 3);
  const b = deriveSeed(99, 18, 3);
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
});

test('bounded draws stay within the requested integer range', () => {
  const rng = Xoshiro128StarStar.fromSeed(7, 1);
  for (let index = 0; index < 1000; index += 1) {
    const value = rng.nextBounded(7);
    assert(value >= 0 && value < 7);
  }
});
