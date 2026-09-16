import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { CHUNK_SPAN_Q16, Q16_ONE } from '../src/core/index.js';
import { DeterministicAgentSimulation } from '../src/sim/index.js';

const expected = JSON.parse(await readFile(new URL('../fixtures/fw-005-golden.json', import.meta.url), 'utf8'));

function uniformField() {
  const layer = Object.freeze({
    id: 1,
    kind: 'vector',
    operator: 'uniform',
    enabled: true,
    blend: 'add',
    transform: Object.freeze({ origin: Object.freeze({ chunkX: 0, chunkY: 0, localX: 0, localY: 0 }) }),
    parameters: Object.freeze({ vectorXQ16: Q16_ONE / 8, vectorYQ16: Q16_ONE / 16 })
  });
  return Object.freeze({ orderedLayers: () => [layer] });
}

function pointEmitter(id, materialId, overrides = {}) {
  return {
    id,
    materialId,
    startTick: 0,
    stopTick: overrides.stopTick ?? 5,
    intervalTicks: overrides.intervalTicks ?? 1,
    rate: overrides.rate ?? 2,
    bursts: overrides.bursts ?? [],
    geometry: overrides.geometry ?? {
      type: 'point',
      origin: { chunkX: 0, chunkY: 0, localX: 0, localY: 0 }
    },
    velocityXQ16: overrides.velocityXQ16 ?? Q16_ONE / 2,
    velocityYQ16: overrides.velocityYQ16 ?? Q16_ONE / 4,
    velocityJitterQ16: overrides.velocityJitterQ16 ?? Q16_ONE / 16
  };
}

function hashes(simulation) {
  return {
    stateHash: simulation.stateHash(),
    depositionHash: simulation.depositionHash(),
    resultHash: simulation.resultHash()
  };
}

function individual(materialId) {
  const simulation = new DeterministicAgentSimulation({
    rootSeed: 0x12345678,
    capacity: 256,
    maxDepositions: 50_000,
    fieldCollection: uniformField(),
    emitters: [pointEmitter(100 + materialId, materialId)]
  });
  simulation.runTicks(24);
  return simulation;
}

function mixed() {
  const simulation = new DeterministicAgentSimulation({
    rootSeed: 0x2468ace0,
    capacity: 512,
    maxDepositions: 100_000,
    fieldCollection: uniformField(),
    emitters: [
      pointEmitter(11, 1, { stopTick: 7, rate: 2 }),
      pointEmitter(22, 2, {
        stopTick: 7,
        rate: 1,
        geometry: {
          type: 'box',
          origin: { chunkX: 0, chunkY: 0, localX: -4 * Q16_ONE, localY: 2 * Q16_ONE },
          widthQ16: 12 * Q16_ONE,
          heightQ16: 8 * Q16_ONE
        }
      }),
      pointEmitter(33, 3, {
        stopTick: 7,
        rate: 3,
        intervalTicks: 2,
        geometry: {
          type: 'mask',
          origin: { chunkX: -1, chunkY: 0, localX: CHUNK_SPAN_Q16 - 2 * Q16_ONE, localY: 3 * Q16_ONE },
          points: [
            { xQ16: -Q16_ONE, yQ16: 0 },
            { xQ16: 0, yQ16: Q16_ONE },
            { xQ16: Q16_ONE, yQ16: -Q16_ONE }
          ]
        }
      }),
      pointEmitter(44, 4, {
        stopTick: 7,
        rate: 1,
        bursts: [{ tick: 3, count: 3 }],
        velocityXQ16: -Q16_ONE / 2,
        velocityYQ16: Q16_ONE / 2
      })
    ]
  });
  simulation.runTicks(64);
  return simulation;
}

function chunkCrossing() {
  const simulation = new DeterministicAgentSimulation({
    rootSeed: 0x10203040,
    capacity: 16,
    maxDepositions: 100,
    emitters: [pointEmitter(7, 2, {
      stopTick: 0,
      rate: 1,
      velocityJitterQ16: 0,
      geometry: {
        type: 'point',
        origin: { chunkX: -1, chunkY: 0, localX: CHUNK_SPAN_Q16 - Q16_ONE, localY: 0 }
      },
      velocityXQ16: 4 * Q16_ONE,
      velocityYQ16: 0
    })]
  });
  simulation.runTicks(4);
  return simulation;
}

function longRun() {
  const simulation = new DeterministicAgentSimulation({
    rootSeed: 0xfedcba98,
    capacity: 256,
    maxDepositions: 100_000,
    fieldCollection: uniformField(),
    emitters: [pointEmitter(77, 1, { stopTick: 20, rate: 1, velocityJitterQ16: Q16_ONE / 32 })]
  });
  simulation.runTicks(1000);
  return simulation;
}

function computeFixture() {
  return {
    version: 'fw-agents-v1',
    individual: {
      ink: hashes(individual(1)),
      filament: hashes(individual(2)),
      dust: hashes(individual(3)),
      shard: hashes(individual(4))
    },
    mixed: hashes(mixed()),
    chunkCrossing: hashes(chunkCrossing()),
    longRun: hashes(longRun())
  };
}

test('FW-005 representative scenarios match checked-in canonical golden hashes', () => {
  assert.deepEqual(computeFixture(), expected);
});

test('FW-005 representative scenarios repeat exactly within one process', () => {
  assert.deepEqual(computeFixture(), computeFixture());
});
