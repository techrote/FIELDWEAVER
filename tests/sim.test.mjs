import test from 'node:test';
import assert from 'node:assert/strict';

import { CHUNK_SPAN_Q16, Q16_ONE, INT32_MAX } from '../src/core/index.js';
import {
  MAX_SPEED_Q16,
  SIMULATION_VERSION,
  AgentStore,
  DeterministicAgentSimulation,
  createBaselineMaterials
} from '../src/sim/index.js';

function uniformField(xQ16 = Q16_ONE / 8, yQ16 = Q16_ONE / 16) {
  const layer = Object.freeze({
    id: 1,
    kind: 'vector',
    operator: 'uniform',
    enabled: true,
    blend: 'add',
    transform: Object.freeze({ origin: Object.freeze({ chunkX: 0, chunkY: 0, localX: 0, localY: 0 }) }),
    parameters: Object.freeze({ vectorXQ16: xQ16, vectorYQ16: yQ16 })
  });
  return Object.freeze({ orderedLayers: () => [layer] });
}

function pointEmitter(materialId, overrides = {}) {
  return {
    id: overrides.id ?? materialId,
    materialId,
    startTick: overrides.startTick ?? 0,
    stopTick: overrides.stopTick,
    intervalTicks: overrides.intervalTicks ?? 1,
    rate: overrides.rate ?? 1,
    bursts: overrides.bursts ?? [],
    geometry: overrides.geometry ?? {
      type: 'point',
      origin: { chunkX: 0, chunkY: 0, localX: 0, localY: 0 }
    },
    velocityXQ16: overrides.velocityXQ16 ?? Q16_ONE / 2,
    velocityYQ16: overrides.velocityYQ16 ?? Q16_ONE / 4,
    velocityJitterQ16: overrides.velocityJitterQ16 ?? 0
  };
}

function runScenario(materialId, ticks = 24) {
  const sim = new DeterministicAgentSimulation({
    rootSeed: 0x12345678,
    capacity: 256,
    maxDepositions: 50_000,
    fieldCollection: uniformField(),
    emitters: [pointEmitter(materialId, { stopTick: 5, rate: 2, velocityJitterQ16: Q16_ONE / 16 })]
  });
  sim.runTicks(ticks);
  return sim;
}

test('baseline material registry exposes four distinct validated behaviours', () => {
  const materials = createBaselineMaterials();
  assert.equal(materials.length, 4);
  assert.deepEqual(materials.map((material) => material.kind), ['ink', 'filament', 'dust', 'shard']);
  assert.equal(new Set(materials.map((material) => `${material.primitive}:${material.lifetimeTicks}:${material.depositEvery}:${material.quantizeAxis}`)).size, 4);

  const hashes = materials.map((material) => runScenario(material.id).resultHash());
  assert.equal(new Set(hashes).size, 4);
});

test('same recipe substrate seed and tick count reproduces state and deposition hashes', () => {
  const first = runScenario(1, 80);
  const second = runScenario(1, 80);
  assert.equal(first.stateHash(), second.stateHash());
  assert.equal(first.depositionHash(), second.depositionHash());
  assert.equal(first.resultHash(), second.resultHash());
  assert.equal(first.canonicalState().version, SIMULATION_VERSION);
});

test('agent storage uses lowest free numeric ID and deterministic reuse', () => {
  const store = new AgentStore(3);
  const base = {
    emitterId: 1,
    materialId: 1,
    position: { chunkX: 0, chunkY: 0, localX: 0, localY: 0 },
    lifetimeTicks: 10
  };
  assert.equal(store.allocate(base), 1);
  assert.equal(store.allocate(base), 2);
  store.release(1);
  assert.equal(store.allocate(base), 1);
  assert.deepEqual(store.toCanonical().agents.map((agent) => agent.id), [1, 2]);
});

test('lifetime release makes ID reuse deterministic on the following tick', () => {
  const materials = createBaselineMaterials().map((material) => material.id === 1 ? { ...material, lifetimeTicks: 1 } : material);
  const sim = new DeterministicAgentSimulation({
    rootSeed: 9,
    materials,
    capacity: 1,
    maxDepositions: 10,
    emitters: [pointEmitter(1, { rate: 1 })]
  });
  sim.step();
  assert.equal(sim.agents.length, 0);
  sim.step();
  assert.equal(sim.agents.length, 0);
  assert.deepEqual(sim.depositions.map((event) => event.agentId), [1, 1]);
});

test('capacity exhaustion follows stable spawn order and is explicit', () => {
  const sim = new DeterministicAgentSimulation({
    rootSeed: 11,
    capacity: 1,
    maxDepositions: 20,
    emitters: [pointEmitter(1, { rate: 2, stopTick: 0 })]
  });
  sim.step();
  assert.equal(sim.totalSpawned, 1);
  assert.equal(sim.droppedSpawns, 1);
  assert.equal(sim.agents.length, 1);
  assert.equal(sim.canonicalState().emitters[0].dropped, 1);
});

test('independent emitter PRNG substreams survive unrelated emitter insertion', () => {
  const primary = pointEmitter(1, {
    id: 10,
    geometry: {
      type: 'mask',
      origin: { chunkX: 0, chunkY: 0, localX: 0, localY: 0 },
      points: [
        { xQ16: -Q16_ONE, yQ16: 0 },
        { xQ16: Q16_ONE, yQ16: 0 },
        { xQ16: 0, yQ16: Q16_ONE }
      ]
    },
    velocityJitterQ16: Q16_ONE / 8,
    stopTick: 3
  });
  const unrelated = pointEmitter(2, { id: 20, stopTick: 3, velocityJitterQ16: Q16_ONE / 7 });
  const make = (emitters) => new DeterministicAgentSimulation({ rootSeed: 0x87654321, capacity: 64, maxDepositions: 500, emitters });
  const alone = make([primary]);
  const combined = make([primary, unrelated]);
  alone.runTicks(4);
  combined.runTicks(4);

  const stripIds = (simulation) => simulation.canonicalState().agents.agents
    .filter((agent) => agent.emitterId === 10)
    .map(({ id, ...agent }) => agent);
  assert.deepEqual(stripIds(combined), stripIds(alone));
  assert.deepEqual(combined.canonicalState().emitters.find((entry) => entry.id === 10).rng,
    alone.canonicalState().emitters.find((entry) => entry.id === 10).rng);
});

test('velocity and step displacement remain inside the canonical bound', () => {
  const sim = new DeterministicAgentSimulation({
    rootSeed: 4,
    capacity: 16,
    maxDepositions: 100,
    fieldCollection: uniformField(INT32_MAX, -INT32_MAX),
    emitters: [pointEmitter(4, { stopTick: 0, velocityXQ16: INT32_MAX, velocityYQ16: -INT32_MAX })]
  });
  sim.step();
  const agent = sim.canonicalState().agents.agents[0];
  assert.ok(Math.abs(agent.velocityXQ16) <= MAX_SPEED_Q16);
  assert.ok(Math.abs(agent.velocityYQ16) <= MAX_SPEED_Q16);
  const event = sim.depositions[0];
  const dx = (event.to.chunkX - event.from.chunkX) * CHUNK_SPAN_Q16 + event.to.localX - event.from.localX;
  const dy = (event.to.chunkY - event.from.chunkY) * CHUNK_SPAN_Q16 + event.to.localY - event.from.localY;
  assert.ok(Math.abs(dx) <= MAX_SPEED_Q16);
  assert.ok(Math.abs(dy) <= MAX_SPEED_Q16);
});

test('chunk crossing normalizes canonically', () => {
  const sim = new DeterministicAgentSimulation({
    rootSeed: 5,
    capacity: 4,
    maxDepositions: 20,
    emitters: [pointEmitter(2, {
      stopTick: 0,
      geometry: {
        type: 'point',
        origin: { chunkX: 0, chunkY: 0, localX: CHUNK_SPAN_Q16 - Q16_ONE, localY: 0 }
      },
      velocityXQ16: 4 * Q16_ONE,
      velocityYQ16: 0
    })]
  });
  sim.step();
  const agent = sim.canonicalState().agents.agents[0];
  assert.equal(agent.position.chunkX, 1);
  assert.ok(agent.position.localX >= 0 && agent.position.localX < CHUNK_SPAN_Q16);
});

test('deposition stream is renderer-sufficient canonical data', () => {
  const sim = runScenario(2, 2);
  const event = sim.depositions[0];
  assert.deepEqual(Object.keys(event), [
    'tick', 'sequence', 'agentId', 'emitterId', 'materialId', 'materialKind', 'primitive',
    'from', 'to', 'radiusQ16', 'strengthQ16'
  ]);
  assert.equal(typeof event.tick, 'number');
  assert.equal(typeof event.sequence, 'number');
  assert.equal(typeof event.emitterId, 'number');
  assert.equal(event.primitive, 'segment');
  assert.ok(event.from && event.to);
});

test('deposition retention limit fails loudly rather than silently dropping provenance', () => {
  const sim = new DeterministicAgentSimulation({
    rootSeed: 1,
    capacity: 4,
    maxDepositions: 1,
    emitters: [pointEmitter(1, { rate: 2, stopTick: 0 })]
  });
  assert.throws(() => sim.step(), /deposition capacity exhausted/i);
});
