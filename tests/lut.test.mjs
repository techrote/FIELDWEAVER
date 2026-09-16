import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { Q16_ONE } from '../src/core/numeric.js';
import { FieldLayerCollection } from '../src/fields/index.js';
import {
  LUT_VALUE_MAX,
  LutRegistry,
  createBuiltinLuts,
  createDefaultLutMappings,
  createGeneratedLut,
  createLutAsset,
  createLutMapping,
  hashLutAsset,
  parseLutAsset,
  sampleLutIndex,
  sampleLutMappedValue,
  serializeLutAsset
} from '../src/lut/index.js';
import { DeterministicAgentSimulation, createBaselineMaterials } from '../src/sim/index.js';

const golden = JSON.parse(await readFile(new URL('../fixtures/lut-golden.json', import.meta.url), 'utf8'));

function pos(x, y) {
  return { chunkX: 0, chunkY: 0, localX: x * Q16_ONE, localY: y * Q16_ONE };
}

function pointEmitter(id, materialId, x = 8, y = 8) {
  return {
    id,
    materialId,
    startTick: 0,
    intervalTicks: 1,
    rate: 1,
    bursts: [],
    geometry: { type: 'point', origin: pos(x, y) },
    velocityXQ16: Math.round(Q16_ONE / 3),
    velocityYQ16: 0,
    velocityJitterQ16: Math.round(Q16_ONE / 16)
  };
}

function uniformFields() {
  const fields = new FieldLayerCollection();
  fields.createLayer({
    kind: 'vector',
    operator: 'uniform',
    blend: 'add',
    parameters: { vectorXQ16: Math.round(Q16_ONE / 8), vectorYQ16: Math.round(Q16_ONE / 16) }
  });
  return fields;
}

test('built-in 256 and 512 LUTs round-trip with stable hashes', () => {
  const [spectrum, pulse] = createBuiltinLuts();
  assert.equal(spectrum.size, 256);
  assert.equal(pulse.size, 512);
  for (const asset of [spectrum, pulse]) {
    const reparsed = parseLutAsset(serializeLutAsset(asset));
    assert.equal(hashLutAsset(reparsed), hashLutAsset(asset));
    assert.deepEqual(reparsed, asset);
  }
  assert.equal(hashLutAsset(spectrum), golden.spectrum256Hash);
  assert.equal(hashLutAsset(pulse), golden.pulse512Hash);
});

test('clamp/wrap indexing and integer scaling are exact and repeatable', () => {
  const asset = createLutAsset({ id: 99, name: 'steps', size: 4, channels: { logic: [0, 100, 200, 300] } });
  const clamp = createLutMapping({
    id: 1, materialId: 1, lutId: 99, source: 'ageTicks', channel: 'logic',
    destination: 'depositionStrengthQ16', addressMode: 'clamp', inputMin: 10, inputMax: 13,
    scaleNumerator: 3, scaleDenominator: 2, bias: 7, outputMin: 0, outputMax: 1000
  });
  const wrap = createLutMapping({ ...clamp, id: 2, addressMode: 'wrap' });
  assert.equal(sampleLutIndex(clamp, -50, asset.size), 0);
  assert.equal(sampleLutIndex(clamp, 99, asset.size), 3);
  assert.equal(sampleLutIndex(wrap, 9, asset.size), 3);
  assert.equal(sampleLutIndex(wrap, 14, asset.size), 0);
  assert.equal(sampleLutMappedValue(asset, clamp, 12), 307);
  assert.equal(sampleLutMappedValue(asset, clamp, 12), 307);
});

test('invalid LUT assets/mappings fail explicitly', () => {
  assert.throws(() => createLutAsset({ id: 1, size: 256, channels: { logic: [0] } }), /exactly 256/);
  assert.throws(() => createLutMapping({
    id: 1, materialId: 1, lutId: 1, source: 'ageTicks', channel: 'logic', destination: 'steeringMultiplierQ16',
    inputMin: 10, inputMax: 5
  }), /inputMax/);
  const noBlue = createLutAsset({ id: 1, size: 2, channels: { r: [0, 1], g: [0, 1] } });
  const color = createLutMapping({
    id: 1, materialId: 1, lutId: 1, source: 'ageTicks', destination: 'color', channel: 'rgba',
    inputMin: 0, inputMax: 1, outputMin: 0, outputMax: LUT_VALUE_MAX
  });
  assert.throws(() => new LutRegistry([noBlue], [color]), /channel b/);
});

test('colour-only LUT changes deposition appearance without perturbing canonical agent evolution or PRNG', () => {
  const materials = createBaselineMaterials();
  const emitters = [pointEmitter(1, 1)];
  const mapping = createLutMapping({
    id: 1, materialId: 1, lutId: 1, source: 'ageTicks', destination: 'color', channel: 'rgba',
    addressMode: 'wrap', inputMin: 0, inputMax: 7, outputMin: 0, outputMax: LUT_VALUE_MAX
  });
  const red = createLutAsset({ id: 1, name: 'red', size: 8, channels: {
    r: Array(8).fill(LUT_VALUE_MAX), g: Array(8).fill(0), b: Array(8).fill(0), a: Array(8).fill(LUT_VALUE_MAX)
  } });
  const blue = createLutAsset({ id: 1, name: 'blue', size: 8, channels: {
    r: Array(8).fill(0), g: Array(8).fill(0), b: Array(8).fill(LUT_VALUE_MAX), a: Array(8).fill(LUT_VALUE_MAX)
  } });
  const common = { rootSeed: 0x12345678, materials, emitters, capacity: 64, maxDepositions: 4096 };
  const simRed = new DeterministicAgentSimulation({ ...common, lutAssets: [red], lutMappings: [mapping] });
  const simBlue = new DeterministicAgentSimulation({ ...common, lutAssets: [blue], lutMappings: [mapping] });
  simRed.runTicks(24);
  simBlue.runTicks(24);
  assert.equal(simRed.stateHash(), simBlue.stateHash());
  assert.deepEqual(simRed.canonicalState(), simBlue.canonicalState());
  assert.notEqual(simRed.depositionHash(), simBlue.depositionHash());
  assert.deepEqual(simRed.depositions[0].colorRgba8, [255, 0, 0, 255]);
  assert.deepEqual(simBlue.depositions[0].colorRgba8, [0, 0, 255, 255]);
});

test('behaviour mapping deterministically changes canonical evolution and has golden hashes', () => {
  const materials = createBaselineMaterials();
  const emitters = [pointEmitter(1, 3)];
  const [spectrum, pulse] = createBuiltinLuts();
  const behaviourMapping = createDefaultLutMappings().find((entry) => entry.destination === 'steeringMultiplierQ16');
  const options = {
    rootSeed: 0x0badf00d,
    materials,
    emitters,
    fieldCollection: uniformFields(),
    capacity: 256,
    maxDepositions: 10000,
    lutAssets: [spectrum, pulse],
    lutMappings: [behaviourMapping]
  };
  const first = new DeterministicAgentSimulation(options);
  const second = new DeterministicAgentSimulation({ ...options, fieldCollection: uniformFields() });
  const baseline = new DeterministicAgentSimulation({ ...options, fieldCollection: uniformFields(), lutAssets: [], lutMappings: [] });
  first.runTicks(32);
  second.runTicks(32);
  baseline.runTicks(32);
  assert.equal(first.stateHash(), second.stateHash());
  assert.equal(first.depositionHash(), second.depositionHash());
  assert.equal(first.resultHash(), second.resultHash());
  assert.notEqual(first.stateHash(), baseline.stateHash());
  assert.equal(first.stateHash(), golden.mappedStateHash);
  assert.equal(first.depositionHash(), golden.mappedDepositionHash);
  assert.equal(first.resultHash(), golden.mappedResultHash);
});

test('radius and deposition-strength LUT destinations flow into canonical deposition records', () => {
  const asset = createLutAsset({ id: 7, name: 'constants', size: 2, channels: { radius: [12000, 12000], strength: [42000, 42000] } });
  const radius = createLutMapping({
    id: 1, materialId: 1, lutId: 7, source: 'constant', channel: 'radius', destination: 'radiusQ16',
    inputMin: 0, inputMax: 0, outputMin: 1, outputMax: Q16_ONE / 2
  });
  const strength = createLutMapping({
    id: 2, materialId: 1, lutId: 7, source: 'constant', channel: 'strength', destination: 'depositionStrengthQ16',
    inputMin: 0, inputMax: 0, outputMin: 0, outputMax: 100000
  });
  const sim = new DeterministicAgentSimulation({
    rootSeed: 11,
    materials: createBaselineMaterials(),
    emitters: [pointEmitter(1, 1)],
    lutAssets: [asset],
    lutMappings: [radius, strength],
    capacity: 32,
    maxDepositions: 256
  });
  sim.runTicks(2);
  assert.equal(sim.depositions[0].radiusQ16, 12000);
  assert.equal(sim.depositions[0].strengthQ16, 42000);
});
