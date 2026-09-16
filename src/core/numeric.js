export const INT32_MIN = -0x80000000;
export const INT32_MAX = 0x7fffffff;
export const UINT32_MAX = 0xffffffff;

export const Q16_SHIFT = 16;
export const Q16_ONE = 1 << Q16_SHIFT;
export const Q16_MIN = INT32_MIN;
export const Q16_MAX = INT32_MAX;

const BI_INT32_MIN = BigInt(INT32_MIN);
const BI_INT32_MAX = BigInt(INT32_MAX);
const BI_Q16_ONE = BigInt(Q16_ONE);

export function assertInt32(value, label = 'value') {
  if (!Number.isInteger(value) || value < INT32_MIN || value > INT32_MAX) {
    throw new RangeError(`${label} must be a signed 32-bit integer.`);
  }
  return value;
}

export function assertUint32(value, label = 'value') {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new RangeError(`${label} must be an unsigned 32-bit integer.`);
  }
  return value;
}

function saturateBigIntToInt32(value) {
  if (value < BI_INT32_MIN) return INT32_MIN;
  if (value > BI_INT32_MAX) return INT32_MAX;
  return Number(value);
}

function roundRatioHalfAwayFromZero(numerator, denominator) {
  if (denominator === 0n) {
    throw new RangeError('Division by zero is not defined for canonical fixed-point arithmetic.');
  }

  const negative = (numerator < 0n) !== (denominator < 0n);
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  let quotient = absoluteNumerator / absoluteDenominator;
  const remainder = absoluteNumerator % absoluteDenominator;

  if (remainder * 2n >= absoluteDenominator) {
    quotient += 1n;
  }

  return negative ? -quotient : quotient;
}

export function addSaturatedInt32(left, right) {
  assertInt32(left, 'left');
  assertInt32(right, 'right');
  return saturateBigIntToInt32(BigInt(left) + BigInt(right));
}

export function subtractSaturatedInt32(left, right) {
  assertInt32(left, 'left');
  assertInt32(right, 'right');
  return saturateBigIntToInt32(BigInt(left) - BigInt(right));
}

export function q16FromInteger(value) {
  assertInt32(value, 'value');
  return saturateBigIntToInt32(BigInt(value) * BI_Q16_ONE);
}

export function q16ToIntegerTrunc(value) {
  assertInt32(value, 'value');
  return Number(BigInt(value) / BI_Q16_ONE);
}

export function q16Multiply(left, right) {
  assertInt32(left, 'left');
  assertInt32(right, 'right');
  const rounded = roundRatioHalfAwayFromZero(BigInt(left) * BigInt(right), BI_Q16_ONE);
  return saturateBigIntToInt32(rounded);
}

export function q16Divide(numerator, denominator) {
  assertInt32(numerator, 'numerator');
  assertInt32(denominator, 'denominator');
  const rounded = roundRatioHalfAwayFromZero(BigInt(numerator) * BI_Q16_ONE, BigInt(denominator));
  return saturateBigIntToInt32(rounded);
}

export function q16ScaleByRatio(value, numerator, denominator) {
  assertInt32(value, 'value');
  assertInt32(numerator, 'numerator');
  assertInt32(denominator, 'denominator');
  const rounded = roundRatioHalfAwayFromZero(BigInt(value) * BigInt(numerator), BigInt(denominator));
  return saturateBigIntToInt32(rounded);
}

export function compareInt32(left, right) {
  assertInt32(left, 'left');
  assertInt32(right, 'right');
  return left === right ? 0 : (left < right ? -1 : 1);
}
