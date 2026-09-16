import { Q16_ONE } from './core/numeric.js';
import { FieldLayerCollection } from './fields/index.js';
import { DeterministicAgentSimulation, createBaselineMaterials } from './sim/index.js';

const DEMO_ROOT_SEED = 0x46d2a71b;
const DEMO_TICKS = 220;

function position(x, y) {
  return Object.freeze({
    chunkX: 0,
    chunkY: 0,
    localX: x * Q16_ONE,
    localY: y * Q16_ONE
  });
}

export function createRendererDemoSimulation() {
  const fields = new FieldLayerCollection();
  fields.createLayer({
    id: 1,
    kind: 'vector',
    operator: 'uniform',
    blend: 'add',
    parameters: {
      vectorXQ16: Math.round(Q16_ONE / 12),
      vectorYQ16: 0
    }
  });
  fields.createLayer({
    id: 2,
    kind: 'vector',
    operator: 'vortex',
    blend: 'add',
    transform: { origin: position(142, 128) },
    parameters: {
      strengthQ16: Math.round(Q16_ONE * 0.55),
      radiusQ16: 90 * Q16_ONE
    }
  });

  const materials = createBaselineMaterials();
  const emitters = materials.map((material, index) => Object.freeze({
    id: index + 1,
    materialId: material.id,
    startTick: index * 4,
    stopTick: 112 + index * 7,
    intervalTicks: material.kind === 'dust' ? 2 : 1,
    rate: material.kind === 'filament' ? 1 : 2,
    bursts: [{ tick: 18 + index * 11, count: 10 + index * 3 }],
    geometry: {
      type: 'box',
      origin: position(52, 73 + index * 34),
      widthQ16: 7 * Q16_ONE,
      heightQ16: 6 * Q16_ONE
    },
    velocityXQ16: material.kind === 'shard' ? Math.round(Q16_ONE * 1.25) : Math.round(Q16_ONE * 0.9),
    velocityYQ16: Math.round((index - 1.5) * Q16_ONE * 0.08),
    velocityJitterQ16: Math.round(Q16_ONE * 0.12)
  }));

  const simulation = new DeterministicAgentSimulation({
    rootSeed: DEMO_ROOT_SEED,
    materials,
    emitters,
    fieldCollection: fields,
    capacity: 4096,
    maxDepositions: 150_000
  });
  simulation.runTicks(DEMO_TICKS);
  return Object.freeze({
    simulation,
    fieldCollection: fields,
    emitters: simulation.emitters,
    rootSeed: DEMO_ROOT_SEED,
    tick: DEMO_TICKS
  });
}
