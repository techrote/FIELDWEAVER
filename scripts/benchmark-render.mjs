import { performance } from 'node:perf_hooks';
import { Q16_ONE } from '../src/core/numeric.js';
import {
  PreviewAccumulator,
  PreviewGeometryCache,
  createViewport,
  createViewportTransform,
  panViewport,
  zoomViewport
} from '../src/renderer/index.js';

const COUNT = 63_726;
const VIEW_ROUNDS = 120;
const kinds = ['ink', 'filament', 'dust', 'shard'];
const STANDARD_RADIUS_Q16 = Math.round(Q16_ONE / 3);

function position(x, y) {
  return { chunkX: 0, chunkY: 0, localX: x * Q16_ONE, localY: y * Q16_ONE };
}

function makeDepositions() {
  const records = new Array(COUNT);
  for (let index = 0; index < COUNT; index += 1) {
    const kind = kinds[index % kinds.length];
    const x = 16 + (index * 17) % 224;
    const y = 16 + (index * 29) % 224;
    records[index] = Object.freeze({
      tick: index % 512,
      sequence: index,
      agentId: (index % 4096) + 1,
      emitterId: (index % 4) + 1,
      materialId: (index % 4) + 1,
      materialKind: kind,
      primitive: kind === 'ink' ? 'disc' : kind === 'dust' ? 'point' : 'segment',
      from: position(x, y),
      to: position(Math.min(255, x + 1), Math.min(255, y + 1)),
      radiusQ16: kind === 'dust' ? Q16_ONE / 8 : STANDARD_RADIUS_Q16,
      strengthQ16: Q16_ONE
    });
  }
  return records;
}

function percentile(sorted, q) {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
}

const depositions = makeDepositions();
const accumulator = new PreviewAccumulator(100_000);
accumulator.appendMany(depositions);
const cache = new PreviewGeometryCache();
const initialViewport = createViewport({
  widthCssPx: 1118,
  heightCssPx: 710,
  devicePixelRatio: 1.13,
  zoom: 3.25,
  center: position(132, 128)
});

const buildStarted = performance.now();
const initial = cache.rebuild(accumulator.snapshot(), accumulator.revision, initialViewport);
const initialBuildMs = performance.now() - buildStarted;

const viewTimings = [];
let viewport = initialViewport;
for (let index = 0; index < VIEW_ROUNDS; index += 1) {
  viewport = panViewport(viewport, (index % 7) - 3, (index % 5) - 2);
  if (index % 6 === 0) viewport = zoomViewport(viewport, 1.003);
  const started = performance.now();
  const state = cache.snapshot(false);
  if (!state || !cache.matches(accumulator.revision)) throw new Error('Stable view interaction unexpectedly invalidated geometry cache.');
  const transform = createViewportTransform(state.referenceViewport, viewport);
  if (!Number.isFinite(transform.clipScaleX) || !Number.isFinite(transform.clipOffsetY)) {
    throw new Error('Viewport transform produced non-finite values.');
  }
  viewTimings.push(performance.now() - started);
}
viewTimings.sort((a, b) => a - b);
if (cache.rebuildCount !== 1) throw new Error(`View-only benchmark rebuilt geometry ${cache.rebuildCount} times.`);

const result = {
  scenario: 'FW-016 64k cached preview interaction preparation',
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  depositions: COUNT,
  viewport: '1118x710@1.13x',
  initialBuildMs: Number(initialBuildMs.toFixed(3)),
  viewRounds: VIEW_ROUNDS,
  viewMedianMs: Number(percentile(viewTimings, 0.5).toFixed(4)),
  viewP95Ms: Number(percentile(viewTimings, 0.95).toFixed(4)),
  geometryRebuilds: cache.rebuildCount,
  vertices: initial.artwork.pointCount + initial.artwork.lineVertexCount,
  bufferBytes: initial.artwork.byteLength
};

console.log(JSON.stringify(result, null, 2));
console.log('Timing is diagnostic only; structural cache reuse is the correctness gate.');
