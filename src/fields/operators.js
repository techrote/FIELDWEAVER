import {
  INT32_MAX,
  Q16_ONE,
  addSaturatedInt32,
  assertInt32,
  q16Multiply,
  q16ScaleByRatio
} from '../core/numeric.js';
import { CHUNK_SPAN_Q16, normalizeWorldPosition } from '../core/coordinates.js';
import { canonicalHash } from '../core/canonical.js';

export const FIELD_OPERATOR_VERSION = 'fw-operators-v1';
export const FIELD_OPERATORS = Object.freeze([
  'uniform',
  'attractor',
  'vortex',
  'turbulence',
  'direction-quantizer'
]);

const QUANTIZER_SECTORS = Object.freeze([4, 8, 16]);
const ZERO_VECTOR = Object.freeze({ xQ16: 0, yQ16: 0 });

const DIRECTION_TABLES = Object.freeze({
  4: Object.freeze([
    Object.freeze([Q16_ONE, 0]), Object.freeze([0, Q16_ONE]),
    Object.freeze([-Q16_ONE, 0]), Object.freeze([0, -Q16_ONE])
  ]),
  8: Object.freeze([
    Object.freeze([Q16_ONE, 0]), Object.freeze([46341, 46341]),
    Object.freeze([0, Q16_ONE]), Object.freeze([-46341, 46341]),
    Object.freeze([-Q16_ONE, 0]), Object.freeze([-46341, -46341]),
    Object.freeze([0, -Q16_ONE]), Object.freeze([46341, -46341])
  ]),
  16: Object.freeze([
    Object.freeze([Q16_ONE, 0]), Object.freeze([60547, 25080]),
    Object.freeze([46341, 46341]), Object.freeze([25080, 60547]),
    Object.freeze([0, Q16_ONE]), Object.freeze([-25080, 60547]),
    Object.freeze([-46341, 46341]), Object.freeze([-60547, 25080]),
    Object.freeze([-Q16_ONE, 0]), Object.freeze([-60547, -25080]),
    Object.freeze([-46341, -46341]), Object.freeze([-25080, -60547]),
    Object.freeze([0, -Q16_ONE]), Object.freeze([25080, -60547]),
    Object.freeze([46341, -46341]), Object.freeze([60547, -25080])
  ])
});

export const FIELD_OPERATOR_REGISTRY = Object.freeze({
  uniform: Object.freeze({
    kind: 'source',
    parameters: Object.freeze({ vectorXQ16: 'int32', vectorYQ16: 'int32' }),
    support: 'global'
  }),
  attractor: Object.freeze({
    kind: 'source',
    parameters: Object.freeze({ strengthQ16: 'int32', radiusQ16: 'positive-int32' }),
    support: 'finite-chebyshev'
  }),
  vortex: Object.freeze({
    kind: 'source',
    parameters: Object.freeze({ strengthQ16: 'int32', radiusQ16: 'positive-int32' }),
    support: 'finite-chebyshev'
  }),
  turbulence: Object.freeze({
    kind: 'source',
    parameters: Object.freeze({ seed: 'int32', amplitudeQ16: 'nonnegative-int32', cellSizeQ16: 'chunk-divisor-q16' }),
    support: 'global-procedural'
  }),
  'direction-quantizer': Object.freeze({
    kind: 'transform',
    parameters: Object.freeze({ sectors: '4|8|16' }),
    support: 'stack-transform'
  })
});

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parameter(layer, name, fallback) {
  const value = layer.parameters?.[name];
  return value === undefined ? fallback : value;
}

function assertPositiveInt32(value, label) {
  assertInt32(value, label);
  if (value <= 0) throw new RangeError(`${label} must be a positive signed 32-bit integer.`);
  return value;
}

function assertNonnegativeInt32(value, label) {
  assertInt32(value, label);
  if (value < 0) throw new RangeError(`${label} must be a nonnegative signed 32-bit integer.`);
  return value;
}

function validateCommonLayer(layer) {
  if (layer === null || typeof layer !== 'object') throw new TypeError('Field operator layer must be an object.');
  if (!FIELD_OPERATORS.includes(layer.operator)) {
    throw new RangeError(`Unsupported field operator: ${String(layer.operator)}.`);
  }
  if (layer.kind !== 'vector') throw new RangeError(`Operator ${layer.operator} requires a vector field layer.`);
  if (!['replace', 'add', 'min', 'max'].includes(layer.blend)) {
    throw new RangeError(`Unsupported field blend mode: ${String(layer.blend)}.`);
  }
  if (typeof layer.enabled !== 'boolean') throw new TypeError('layer.enabled must be boolean.');
  if (!isPlainObject(layer.parameters)) throw new TypeError('layer.parameters must be a plain object.');
}

export function validateFieldOperatorLayer(layer) {
  validateCommonLayer(layer);
  switch (layer.operator) {
    case 'uniform':
      assertInt32(parameter(layer, 'vectorXQ16', 0), 'parameters.vectorXQ16');
      assertInt32(parameter(layer, 'vectorYQ16', 0), 'parameters.vectorYQ16');
      break;
    case 'attractor':
    case 'vortex':
      assertInt32(parameter(layer, 'strengthQ16', Q16_ONE), 'parameters.strengthQ16');
      assertPositiveInt32(parameter(layer, 'radiusQ16', Q16_ONE), 'parameters.radiusQ16');
      break;
    case 'turbulence': {
      assertInt32(parameter(layer, 'seed', 0), 'parameters.seed');
      assertNonnegativeInt32(parameter(layer, 'amplitudeQ16', Q16_ONE), 'parameters.amplitudeQ16');
      const cellSizeQ16 = assertPositiveInt32(parameter(layer, 'cellSizeQ16', Q16_ONE), 'parameters.cellSizeQ16');
      if (CHUNK_SPAN_Q16 % cellSizeQ16 !== 0) {
        throw new RangeError('parameters.cellSizeQ16 must divide the canonical chunk span exactly.');
      }
      break;
    }
    case 'direction-quantizer': {
      const sectors = parameter(layer, 'sectors', 8);
      if (!QUANTIZER_SECTORS.includes(sectors)) {
        throw new RangeError('parameters.sectors must be exactly 4, 8, or 16.');
      }
      break;
    }
    default:
      throw new RangeError(`Unsupported field operator: ${layer.operator}.`);
  }
  return layer;
}

function vector(xQ16, yQ16) {
  return Object.freeze({
    xQ16: assertInt32(xQ16, 'vector.xQ16'),
    yQ16: assertInt32(yQ16, 'vector.yQ16')
  });
}

function normalizedWorldDelta(originInput, positionInput) {
  const origin = normalizeWorldPosition(originInput);
  const position = normalizeWorldPosition(positionInput);
  const dx = (BigInt(position.chunkX) - BigInt(origin.chunkX)) * BigInt(CHUNK_SPAN_Q16)
    + BigInt(position.localX) - BigInt(origin.localX);
  const dy = (BigInt(position.chunkY) - BigInt(origin.chunkY)) * BigInt(CHUNK_SPAN_Q16)
    + BigInt(position.localY) - BigInt(origin.localY);
  return { dx, dy };
}

function finitePointSample(layer, position, rotational) {
  const radiusQ16 = parameter(layer, 'radiusQ16', Q16_ONE);
  const strengthQ16 = parameter(layer, 'strengthQ16', Q16_ONE);
  const { dx, dy } = normalizedWorldDelta(layer.transform.origin, position);
  const radius = BigInt(radiusQ16);
  const absoluteX = dx < 0n ? -dx : dx;
  const absoluteY = dy < 0n ? -dy : dy;
  const distance = absoluteX > absoluteY ? absoluteX : absoluteY;

  if (distance === 0n || distance > radius) return ZERO_VECTOR;
  if (distance > BigInt(INT32_MAX)) return ZERO_VECTOR;

  const distanceInt = Number(distance);
  const dxInt = Number(dx);
  const dyInt = Number(dy);
  const falloffStrength = q16ScaleByRatio(strengthQ16, radiusQ16 - distanceInt, radiusQ16);

  let directionX;
  let directionY;
  if (rotational) {
    directionX = q16ScaleByRatio(Q16_ONE, -dyInt, distanceInt);
    directionY = q16ScaleByRatio(Q16_ONE, dxInt, distanceInt);
  } else {
    directionX = q16ScaleByRatio(Q16_ONE, -dxInt, distanceInt);
    directionY = q16ScaleByRatio(Q16_ONE, -dyInt, distanceInt);
  }

  return vector(q16Multiply(directionX, falloffStrength), q16Multiply(directionY, falloffStrength));
}

function foldBigInt32(value) {
  return Number(BigInt.asUintN(32, value));
}

function mix32(value) {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

function noiseHash(seed, latticeX, latticeY, salt) {
  let value = (seed >>> 0) ^ salt;
  value = mix32(value ^ foldBigInt32(latticeX));
  value = mix32(value ^ Math.imul(foldBigInt32(latticeY), 0x9e3779b1));
  return value >>> 0;
}

function signed16FromHash(hash) {
  return (hash & 0xffff) - 0x8000;
}

function turbulenceSample(layer, positionInput) {
  const position = normalizeWorldPosition(positionInput);
  const seed = parameter(layer, 'seed', 0);
  const amplitudeQ16 = parameter(layer, 'amplitudeQ16', Q16_ONE);
  const cellSizeQ16 = parameter(layer, 'cellSizeQ16', Q16_ONE);
  const cellsPerChunk = BigInt(CHUNK_SPAN_Q16 / cellSizeQ16);
  const latticeX = BigInt(position.chunkX) * cellsPerChunk + BigInt(Math.floor(position.localX / cellSizeQ16));
  const latticeY = BigInt(position.chunkY) * cellsPerChunk + BigInt(Math.floor(position.localY / cellSizeQ16));
  const xNoise = signed16FromHash(noiseHash(seed, latticeX, latticeY, 0x243f6a88));
  const yNoise = signed16FromHash(noiseHash(seed, latticeX, latticeY, 0xb7e15162));
  return vector(
    q16ScaleByRatio(amplitudeQ16, xNoise, 0x8000),
    q16ScaleByRatio(amplitudeQ16, yNoise, 0x8000)
  );
}

function sampleSourceOperator(layer, position) {
  switch (layer.operator) {
    case 'uniform':
      return vector(parameter(layer, 'vectorXQ16', 0), parameter(layer, 'vectorYQ16', 0));
    case 'attractor':
      return finitePointSample(layer, position, false);
    case 'vortex':
      return finitePointSample(layer, position, true);
    case 'turbulence':
      return turbulenceSample(layer, position);
    default:
      throw new RangeError(`Operator ${layer.operator} is not a source operator.`);
  }
}

function quantizeVector(input, sectors) {
  if (input.xQ16 === 0 && input.yQ16 === 0) return ZERO_VECTOR;
  const directions = DIRECTION_TABLES[sectors];
  let best = directions[0];
  let bestDot = null;
  for (const direction of directions) {
    const dot = BigInt(input.xQ16) * BigInt(direction[0]) + BigInt(input.yQ16) * BigInt(direction[1]);
    if (bestDot === null || dot > bestDot) {
      bestDot = dot;
      best = direction;
    }
  }

  const absoluteX = input.xQ16 === -0x80000000 ? INT32_MAX : Math.abs(input.xQ16);
  const absoluteY = input.yQ16 === -0x80000000 ? INT32_MAX : Math.abs(input.yQ16);
  const magnitudeQ16 = Math.max(absoluteX, absoluteY);
  return vector(q16Multiply(magnitudeQ16, best[0]), q16Multiply(magnitudeQ16, best[1]));
}

function blendVector(accumulator, sampled, blend) {
  switch (blend) {
    case 'replace': return sampled;
    case 'add': return vector(
      addSaturatedInt32(accumulator.xQ16, sampled.xQ16),
      addSaturatedInt32(accumulator.yQ16, sampled.yQ16)
    );
    case 'min': return vector(
      Math.min(accumulator.xQ16, sampled.xQ16),
      Math.min(accumulator.yQ16, sampled.yQ16)
    );
    case 'max': return vector(
      Math.max(accumulator.xQ16, sampled.xQ16),
      Math.max(accumulator.yQ16, sampled.yQ16)
    );
    default: throw new RangeError(`Unsupported field blend mode: ${blend}.`);
  }
}

export function sampleFieldOperator(layer, position, input = ZERO_VECTOR) {
  validateFieldOperatorLayer(layer);
  const normalizedPosition = normalizeWorldPosition(position);
  if (layer.operator === 'direction-quantizer') {
    return quantizeVector(input, parameter(layer, 'sectors', 8));
  }
  return sampleSourceOperator(layer, normalizedPosition);
}

export function sampleFieldStack(collection, position, options = {}) {
  if (collection === null || typeof collection !== 'object' || typeof collection.orderedLayers !== 'function') {
    throw new TypeError('collection must expose orderedLayers().');
  }
  if (!isPlainObject(options)) throw new TypeError('options must be a plain object.');
  const debug = options.debug ?? false;
  if (typeof debug !== 'boolean') throw new TypeError('options.debug must be boolean.');

  const normalizedPosition = normalizeWorldPosition(position);
  let accumulator = ZERO_VECTOR;
  const trace = [];

  for (const layer of collection.orderedLayers()) {
    validateFieldOperatorLayer(layer);
    if (!layer.enabled) continue;
    const before = accumulator;
    let sampled;
    if (layer.operator === 'direction-quantizer') {
      sampled = sampleFieldOperator(layer, normalizedPosition, accumulator);
      accumulator = sampled;
    } else {
      sampled = sampleFieldOperator(layer, normalizedPosition, accumulator);
      accumulator = blendVector(accumulator, sampled, layer.blend);
    }
    if (debug) {
      trace.push(Object.freeze({
        id: layer.id,
        operator: layer.operator,
        blend: layer.operator === 'direction-quantizer' ? 'transform' : layer.blend,
        before,
        sampled,
        after: accumulator
      }));
    }
  }

  if (!debug) return accumulator;
  return Object.freeze({ vector: accumulator, layers: Object.freeze(trace) });
}

export function sampleFieldStackHash(collection, positions) {
  if (!Array.isArray(positions)) throw new TypeError('positions must be an array.');
  const samples = positions.map((position) => sampleFieldStack(collection, position));
  return canonicalHash({ version: FIELD_OPERATOR_VERSION, samples });
}
