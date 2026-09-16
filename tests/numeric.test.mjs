import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  INT32_MAX,
  INT32_MIN,
  Q16_ONE,
  addSaturatedInt32,
  subtractSaturatedInt32,
  q16Divide,
  q16FromInteger,
  q16Multiply,
  q16ScaleByRatio,
  q16ToIntegerTrunc
} from '../src/core/index.js';

test('signed integer operations saturate at the documented int32 bounds', () => {
  assert.equal(addSaturatedInt32(INT32_MAX, 1), INT32_MAX);
  assert.equal(subtractSaturatedInt32(INT32_MIN, 1), INT32_MIN);
  assert.equal(addSaturatedInt32(-4, 9), 5);
});

test('Q16.16 conversion and multiplication use nearest ties away from zero', () => {
  assert.equal(q16FromInteger(3), 3 * Q16_ONE);
  assert.equal(q16ToIntegerTrunc(-3 * Q16_ONE - 123), -3);
  assert.equal(q16Multiply(Q16_ONE / 2, Q16_ONE / 2), Q16_ONE / 4);
  assert.equal(q16ScaleByRatio(1, 1, 2), 1);
  assert.equal(q16ScaleByRatio(-1, 1, 2), -1);
});

test('Q16.16 division is checked and saturating', () => {
  assert.equal(q16Divide(Q16_ONE, 2 * Q16_ONE), Q16_ONE / 2);
  assert.equal(q16Divide(INT32_MAX, 1), INT32_MAX);
  assert.throws(() => q16Divide(Q16_ONE, 0), /Division by zero/);
});
