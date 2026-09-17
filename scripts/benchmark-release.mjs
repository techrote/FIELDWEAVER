import { performance } from 'node:perf_hooks';
import { Q16_ONE } from '../src/core/index.js';
import { DeterministicAgentSimulation, createBaselineMaterials } from '../src/sim/index.js';

const TICKS = 470;
const SAMPLES = 3;
const CAPACITY = 30_000;
const seed = 0x14014f14;

function createScenario() {
  const ink = { ...createBaselineMaterials()[0], lifetimeTicks: 2048, depositEvery: 64 };
  return new DeterministicAgentSimulation({
    rootSeed: seed,
    capacity: CAPACITY,
    maxDepositions: 500_000,
    materials: [ink],
    emitters: [{
      id: 1,
      materialId: ink.id,
      startTick: 0,
      intervalTicks: 1,
      rate: 64,
      bursts: [],
      geometry: {
        type: 'box',
        origin: { chunkX: 0, chunkY: 0, localX: 96 * Q16_ONE, localY: 96 * Q16_ONE },
        widthQ16: 64 * Q16_ONE,
        heightQ16: 64 * Q16_ONE
      },
      velocityXQ16: Math.round(Q16_ONE / 2),
      velocityYQ16: Math.round(Q16_ONE / 8),
      velocityJitterQ16: Math.round(Q16_ONE / 16)
    }]
  });
}

function runSample() {
  const simulation = createScenario();
  const started = performance.now();
  simulation.runTicks(TICKS);
  const elapsedMs = performance.now() - started;
  return Object.freeze({
    elapsedMs,
    averageTickMs: elapsedMs / TICKS,
    activeAgents: simulation.agents.length,
    depositions: simulation.depositions.length,
    droppedSpawns: simulation.droppedSpawns,
    stateHash: simulation.stateHash(),
    depositionHash: simulation.depositionHash()
  });
}

// Warm JIT/module paths without reporting the warm-up as a flattering sample.
runSample();
const samples = Array.from({ length: SAMPLES }, runSample);
const stateHashes = new Set(samples.map((sample) => sample.stateHash));
const depositionHashes = new Set(samples.map((sample) => sample.depositionHash));
if (stateHashes.size !== 1 || depositionHashes.size !== 1) throw new Error('Release benchmark violated deterministic hash equivalence across repeated samples.');
if (!samples.every((sample) => sample.activeAgents === CAPACITY)) throw new Error('Release benchmark did not reach the intended 30k active-agent pressure point.');

const elapsed = samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
const middle = elapsed[Math.floor(elapsed.length / 2)];
const result = {
  version: 'fw-release-benchmark-v1',
  scenario: '30k long-lived simple agents under canonical CPU simulation',
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  seed,
  ticks: TICKS,
  samples: SAMPLES,
  activeAgents: samples[0].activeAgents,
  depositions: samples[0].depositions,
  droppedSpawns: samples[0].droppedSpawns,
  elapsedMs: {
    minimum: Number(elapsed[0].toFixed(3)),
    median: Number(middle.toFixed(3)),
    maximum: Number(elapsed[elapsed.length - 1].toFixed(3))
  },
  medianTickMs: Number((middle / TICKS).toFixed(4)),
  stateHash: samples[0].stateHash,
  depositionHash: samples[0].depositionHash,
  note: 'Wall-clock timing is diagnostic only; hash equality and workload shape are the correctness assertions.'
};
console.log(JSON.stringify(result, null, 2));
