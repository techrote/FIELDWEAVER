import { INT32_MAX, INT32_MIN, Q16_ONE, assertInt32 } from './numeric.js';

export const CHUNK_SIZE_CELLS = 256;
export const CHUNK_SPAN_Q16 = CHUNK_SIZE_CELLS * Q16_ONE;
const BI_CHUNK_SPAN_Q16 = BigInt(CHUNK_SPAN_Q16);
const BI_INT32_MIN = BigInt(INT32_MIN);
const BI_INT32_MAX = BigInt(INT32_MAX);

function assertChunkResult(value, axis) {
  if (value < BI_INT32_MIN || value > BI_INT32_MAX) {
    throw new RangeError(`${axis} chunk coordinate overflowed signed 32-bit range.`);
  }
  return Number(value);
}

function normalizeAxisBigInt(chunk, local, axis) {
  assertInt32(chunk, `${axis}.chunk`);
  let quotient = local / BI_CHUNK_SPAN_Q16;
  let remainder = local % BI_CHUNK_SPAN_Q16;

  if (remainder < 0n) {
    quotient -= 1n;
    remainder += BI_CHUNK_SPAN_Q16;
  }

  return Object.freeze({
    chunk: assertChunkResult(BigInt(chunk) + quotient, axis),
    local: Number(remainder)
  });
}

export function normalizeWorldPosition(position) {
  const x = normalizeAxisBigInt(
    assertInt32(position.chunkX, 'position.chunkX'),
    BigInt(assertInt32(position.localX, 'position.localX')),
    'x'
  );
  const y = normalizeAxisBigInt(
    assertInt32(position.chunkY, 'position.chunkY'),
    BigInt(assertInt32(position.localY, 'position.localY')),
    'y'
  );

  return Object.freeze({
    chunkX: x.chunk,
    chunkY: y.chunk,
    localX: x.local,
    localY: y.local
  });
}

export function translateWorldPosition(position, deltaXQ16, deltaYQ16) {
  const chunkX = assertInt32(position.chunkX, 'position.chunkX');
  const chunkY = assertInt32(position.chunkY, 'position.chunkY');
  const localX = assertInt32(position.localX, 'position.localX');
  const localY = assertInt32(position.localY, 'position.localY');
  assertInt32(deltaXQ16, 'deltaXQ16');
  assertInt32(deltaYQ16, 'deltaYQ16');

  const x = normalizeAxisBigInt(chunkX, BigInt(localX) + BigInt(deltaXQ16), 'x');
  const y = normalizeAxisBigInt(chunkY, BigInt(localY) + BigInt(deltaYQ16), 'y');

  return Object.freeze({
    chunkX: x.chunk,
    chunkY: y.chunk,
    localX: x.local,
    localY: y.local
  });
}

export function compareWorldPositions(left, right) {
  const a = normalizeWorldPosition(left);
  const b = normalizeWorldPosition(right);
  const fields = ['chunkY', 'chunkX', 'localY', 'localX'];

  for (const field of fields) {
    if (a[field] !== b[field]) {
      return a[field] < b[field] ? -1 : 1;
    }
  }
  return 0;
}
