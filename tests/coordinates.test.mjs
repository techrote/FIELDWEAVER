import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHUNK_SPAN_Q16,
  Q16_ONE,
  normalizeWorldPosition,
  translateWorldPosition
} from '../src/core/index.js';

test('chunk normalization carries positive local coordinates deterministically', () => {
  assert.deepEqual(normalizeWorldPosition({
    chunkX: 4,
    chunkY: -2,
    localX: CHUNK_SPAN_Q16 + 7,
    localY: 9
  }), {
    chunkX: 5,
    chunkY: -2,
    localX: 7,
    localY: 9
  });
});

test('negative local coordinates use floor-style chunk normalization', () => {
  assert.deepEqual(normalizeWorldPosition({
    chunkX: 0,
    chunkY: 0,
    localX: -1,
    localY: -CHUNK_SPAN_Q16
  }), {
    chunkX: -1,
    chunkY: -1,
    localX: CHUNK_SPAN_Q16 - 1,
    localY: 0
  });
});

test('translation crosses positive and negative chunk boundaries without floating point', () => {
  const start = { chunkX: 10, chunkY: -7, localX: 2, localY: CHUNK_SPAN_Q16 - 2 };
  assert.deepEqual(translateWorldPosition(start, -3, 4), {
    chunkX: 9,
    chunkY: -6,
    localX: CHUNK_SPAN_Q16 - 1,
    localY: 2
  });
  assert.equal(translateWorldPosition(start, Q16_ONE, 0).localX, Q16_ONE + 2);
});

test('chunk-coordinate overflow fails loudly', () => {
  assert.throws(() => normalizeWorldPosition({
    chunkX: 0x7fffffff,
    chunkY: 0,
    localX: CHUNK_SPAN_Q16,
    localY: 0
  }), /overflowed/);
});
