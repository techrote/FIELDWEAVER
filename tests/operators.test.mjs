import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { Q16_ONE } from '../src/core/numeric.js';
import { CHUNK_SPAN_Q16 } from '../src/core/coordinates.js';
import {
  FIELD_OPERATOR_VERSION,
  FIELD_OPERATOR_REGISTRY,
  FieldLayerCollection,
  sampleFieldOperator,
  sampleFieldStack,
  sampleFieldStackHash,
  validateFieldOperatorLayer
} from '../src/fields/index.js';

const golden = JSON.parse(await readFile(new URL('../fixtures/fw-004-golden.json', import.meta.url), 'utf8'));
const ORIGIN = Object.freeze({ chunkX: 0, chunkY: 0, localX: 0, localY: 0 });

function createLayer(operator, parameters, options = {}) {
  const collection = new FieldLayerCollection();
  const layer = collection.createLayer({
    kind: 'vector',
    operator,
    blend: options.blend ?? 'add',
    enabled: options.enabled ?? true,
    transform: options.transform,
    parameters
  });
  return { collection, layer };
}

test('operator registry exposes the five fw-operators-v1 contracts', () => {
  assert.equal(FIELD_OPERATOR_VERSION, golden.version);
  assert.deepEqual(Object.keys(FIELD_OPERATOR_REGISTRY), [
    'uniform', 'attractor', 'vortex', 'turbulence', 'direction-quantizer'
  ]);
});

test('operator validation enforces canonical parameter ranges', () => {
  const { layer } = createLayer('turbulence', { seed: 1, amplitudeQ16: Q16_ONE, cellSizeQ16: Q16_ONE });
  assert.equal(validateFieldOperatorLayer(layer), layer);

  const invalidScale = createLayer('turbulence', { seed: 1, amplitudeQ16: Q16_ONE, cellSizeQ16: 1000 }).layer;
  assert.throws(() => validateFieldOperatorLayer(invalidScale), /divide the canonical chunk span/);

  const invalidSectors = createLayer('direction-quantizer', { sectors: 6 }).layer;
  assert.throws(() => validateFieldOperatorLayer(invalidSectors), /exactly 4, 8, or 16/);

  const scalarCollection = new FieldLayerCollection();
  const scalar = scalarCollection.createLayer({ kind: 'scalar', operator: 'uniform', parameters: {} });
  assert.throws(() => validateFieldOperatorLayer(scalar), /requires a vector field layer/);
});

test('individual operators match checked-in golden vectors', () => {
  const uniform = createLayer('uniform', { vectorXQ16: Q16_ONE, vectorYQ16: -(Q16_ONE / 2) }).layer;
  assert.deepEqual(sampleFieldOperator(uniform, ORIGIN), golden.uniform);

  const attractor = createLayer('attractor', { strengthQ16: Q16_ONE, radiusQ16: 4 * Q16_ONE }).layer;
  assert.deepEqual(
    sampleFieldOperator(attractor, { ...ORIGIN, localX: Q16_ONE }),
    golden.attractorAtOne
  );

  const vortex = createLayer('vortex', { strengthQ16: Q16_ONE, radiusQ16: 4 * Q16_ONE }).layer;
  assert.deepEqual(
    sampleFieldOperator(vortex, { ...ORIGIN, localX: Q16_ONE }),
    golden.vortexAtOne
  );

  const turbulence = createLayer('turbulence', {
    seed: 12345,
    amplitudeQ16: Q16_ONE,
    cellSizeQ16: 4 * Q16_ONE
  }).layer;
  assert.deepEqual(sampleFieldOperator(turbulence, ORIGIN), golden.turbulenceOrigin);

  const quantizer = createLayer('direction-quantizer', { sectors: 4 }, { blend: 'replace' }).layer;
  assert.deepEqual(
    sampleFieldOperator(quantizer, ORIGIN, { xQ16: Q16_ONE, yQ16: Q16_ONE / 4 }),
    golden.quantizedFour
  );
});

test('finite point operators are exactly zero on and outside support bounds', () => {
  for (const operator of ['attractor', 'vortex']) {
    const layer = createLayer(operator, { strengthQ16: Q16_ONE, radiusQ16: 4 * Q16_ONE }).layer;
    assert.deepEqual(sampleFieldOperator(layer, { ...ORIGIN, localX: 4 * Q16_ONE }), { xQ16: 0, yQ16: 0 });
    assert.deepEqual(sampleFieldOperator(layer, { ...ORIGIN, localX: 4 * Q16_ONE + 1 }), { xQ16: 0, yQ16: 0 });
    assert.deepEqual(sampleFieldOperator(layer, ORIGIN), { xQ16: 0, yQ16: 0 });
  }

  const repulsor = createLayer('attractor', { strengthQ16: -Q16_ONE, radiusQ16: 4 * Q16_ONE }).layer;
  assert.deepEqual(sampleFieldOperator(repulsor, { ...ORIGIN, localX: Q16_ONE }), { xQ16: 49152, yQ16: 0 });
});

test('world sampling is seam-free and stable for negative equivalent coordinates', () => {
  const turbulence = createLayer('turbulence', {
    seed: 9876,
    amplitudeQ16: Q16_ONE,
    cellSizeQ16: Q16_ONE
  }).layer;

  const seamLeftRepresentation = { chunkX: 0, chunkY: 0, localX: CHUNK_SPAN_Q16, localY: 3 * Q16_ONE };
  const seamRightRepresentation = { chunkX: 1, chunkY: 0, localX: 0, localY: 3 * Q16_ONE };
  assert.deepEqual(
    sampleFieldOperator(turbulence, seamLeftRepresentation),
    sampleFieldOperator(turbulence, seamRightRepresentation)
  );

  const negativeUnnormalized = { chunkX: 0, chunkY: 0, localX: -Q16_ONE, localY: 0 };
  const negativeNormalized = { chunkX: -1, chunkY: 0, localX: CHUNK_SPAN_Q16 - Q16_ONE, localY: 0 };
  assert.deepEqual(
    sampleFieldOperator(turbulence, negativeUnnormalized),
    sampleFieldOperator(turbulence, negativeNormalized)
  );
});

test('turbulence is seeded, world-anchored, and independent of call order', () => {
  const layer = createLayer('turbulence', {
    seed: -1234567,
    amplitudeQ16: 2 * Q16_ONE,
    cellSizeQ16: 2 * Q16_ONE
  }).layer;
  const target = { chunkX: -2, chunkY: 3, localX: 17 * Q16_ONE, localY: 91 * Q16_ONE };
  const before = sampleFieldOperator(layer, target);
  for (let i = -20; i <= 20; i += 1) {
    sampleFieldOperator(layer, { chunkX: i, chunkY: -i, localX: Q16_ONE, localY: 2 * Q16_ONE });
  }
  assert.deepEqual(sampleFieldOperator(layer, target), before);

  const otherSeed = createLayer('turbulence', {
    seed: -1234566,
    amplitudeQ16: 2 * Q16_ONE,
    cellSizeQ16: 2 * Q16_ONE
  }).layer;
  assert.notDeepEqual(sampleFieldOperator(otherSeed, target), before);
});

test('composition order, quantizer transform, debug trace, and golden stack hash are explicit', () => {
  const collection = new FieldLayerCollection();
  collection.createLayer({
    kind: 'vector', operator: 'uniform', blend: 'add',
    parameters: { vectorXQ16: Q16_ONE, vectorYQ16: Q16_ONE / 2 }
  });
  collection.createLayer({
    kind: 'vector', operator: 'attractor', blend: 'add',
    parameters: { strengthQ16: Q16_ONE, radiusQ16: 4 * Q16_ONE }
  });
  collection.createLayer({
    kind: 'vector', operator: 'direction-quantizer', blend: 'replace',
    parameters: { sectors: 8 }
  });

  const positions = [
    ORIGIN,
    { ...ORIGIN, localX: Q16_ONE },
    { ...ORIGIN, localX: 5 * Q16_ONE }
  ];
  assert.deepEqual(positions.map((position) => sampleFieldStack(collection, position)), golden.composedSamples);
  assert.equal(sampleFieldStackHash(collection, positions), golden.composedHash);

  const debug = sampleFieldStack(collection, positions[1], { debug: true });
  assert.deepEqual(debug.vector, golden.composedSamples[1]);
  assert.equal(debug.layers.length, 3);
  assert.equal(debug.layers[2].blend, 'transform');
  assert.deepEqual(debug.layers[2].after, golden.composedSamples[1]);

  const reverseMeaning = new FieldLayerCollection();
  reverseMeaning.createLayer({
    kind: 'vector', operator: 'uniform', blend: 'replace',
    parameters: { vectorXQ16: 0, vectorYQ16: Q16_ONE }
  });
  reverseMeaning.createLayer({
    kind: 'vector', operator: 'uniform', blend: 'add',
    parameters: { vectorXQ16: Q16_ONE, vectorYQ16: 0 }
  });
  assert.deepEqual(sampleFieldStack(reverseMeaning, ORIGIN), { xQ16: Q16_ONE, yQ16: Q16_ONE });

  const forwardMeaning = new FieldLayerCollection();
  forwardMeaning.createLayer({
    kind: 'vector', operator: 'uniform', blend: 'add',
    parameters: { vectorXQ16: Q16_ONE, vectorYQ16: 0 }
  });
  forwardMeaning.createLayer({
    kind: 'vector', operator: 'uniform', blend: 'replace',
    parameters: { vectorXQ16: 0, vectorYQ16: Q16_ONE }
  });
  assert.deepEqual(sampleFieldStack(forwardMeaning, ORIGIN), { xQ16: 0, yQ16: Q16_ONE });
});
