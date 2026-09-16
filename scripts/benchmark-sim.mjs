import { performance } from 'node:perf_hooks';
import { Q16_ONE } from '../src/core/index.js';
import { DeterministicAgentSimulation } from '../src/sim/index.js';

const ticks = Number.parseInt(process.argv[2] ?? '500', 10);
if (!Number.isInteger(ticks) || ticks <= 0 || ticks > 100_000) {
  throw new RangeError('Usage: node scripts/benchmark-sim.mjs [ticks: 1..100000]');
}

const simulation = new DeterministicAgentSimulation({
  rootSeed: 0x51f17e1d,
  capacity: 30_000,
  maxDepositions: 2_000_000,
  emitters: [
    {
      id: 1,
      materialId: 1,
      startTick: 0,
      intervalTicks: 1,
      rate: 32,
      geometry: {
        type: 'box',
        origin: { chunkX: 0, chunkY: 0, localX: 0, localY: 0 },
        widthQ16: 64 * Q16_ONE,
        heightQ16: 64 * Q16_ONE
      },
      velocityXQ16: Q16_ONE / 2,
      velocityYQ16: Q16_ONE / 4,
      velocityJitterQ16: Q16_ONE / 8
    }
  ]
});

const started = performance.now();
simulation.runTicks(ticks);
const elapsedMs = performance.now() - started;

console.log(JSON.stringify({
  version: 'fw-agents-v1-benchmark-v1',
  ticks,
  elapsedMs: Math.round(elapsedMs * 1000) / 1000,
  averageTickMs: Math.round((elapsedMs / ticks) * 1000) / 1000,
  activeAgents: simulation.agents.length,
  totalSpawned: simulation.totalSpawned,
  droppedSpawns: simulation.droppedSpawns,
  depositions: simulation.depositions.length,
  stateHash: simulation.stateHash(),
  depositionHash: simulation.depositionHash(),
  note: 'Timing is diagnostic only and is never a CI correctness oracle.'
}, null, 2));
