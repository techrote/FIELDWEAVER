import { performance } from 'node:perf_hooks';
import { Q16_ONE } from '../src/core/numeric.js';
import { createViewport, prepareDepositionGeometry } from '../src/renderer/index.js';

const COUNT = 30_000;
const WARMUPS = 4;
const ROUNDS = 12;
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
const viewport = createViewport({
  widthCssPx: 1920,
  heightCssPx: 1080,
  devicePixelRatio: 1,
  zoom: 4,
  center: position(128, 128)
});

for (let index = 0; index < WARMUPS; index += 1) prepareDepositionGeometry(depositions, viewport);

const timings = [];
let geometry;
for (let index = 0; index < ROUNDS; index += 1) {
  const started = performance.now();
  geometry = prepareDepositionGeometry(depositions, viewport);
  timings.push(performance.now() - started);
}
timings.sort((a, b) => a - b);

const result = {
  scenario: 'FW-006 1080p CPU buffer preparation',
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  depositions: COUNT,
  viewport: '1920x1080@1x',
  rounds: ROUNDS,
  medianMs: Number(percentile(timings, 0.5).toFixed(3)),
  p95Ms: Number(percentile(timings, 0.95).toFixed(3)),
  minMs: Number(timings[0].toFixed(3)),
  maxMs: Number(timings[timings.length - 1].toFixed(3)),
  vertices: geometry.pointCount + geometry.lineVertexCount,
  bufferBytes: geometry.byteLength
};

console.log(JSON.stringify(result, null, 2));
console.log('Timing is diagnostic only; no performance threshold is a correctness gate.');
