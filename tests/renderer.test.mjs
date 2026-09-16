import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalHash } from '../src/core/canonical.js';
import { Q16_ONE } from '../src/core/numeric.js';
import { createRendererDemoSimulation } from '../src/demo.js';
import {
  MATERIAL_PREVIEW_STYLES,
  PreviewAccumulator,
  RendererUnavailableError,
  createViewport,
  createWebGL2Renderer,
  panViewport,
  prepareDepositionGeometry,
  prepareFrameModel,
  worldToCanvas,
  zoomViewport
} from '../src/renderer/index.js';

function pos(x, y) {
  return { chunkX: 0, chunkY: 0, localX: x * Q16_ONE, localY: y * Q16_ONE };
}

function deposition(kind, primitive, x, y) {
  return Object.freeze({
    tick: 0,
    sequence: 0,
    agentId: 1,
    emitterId: 1,
    materialId: 1,
    materialKind: kind,
    primitive,
    from: pos(x, y),
    to: pos(x + 1, y + 1),
    radiusQ16: Q16_ONE / 2,
    strengthQ16: Q16_ONE
  });
}

test('viewport transform centers canonical world coordinates and pan/zoom/DPR are view-only', () => {
  const viewport = createViewport({ widthCssPx: 1000, heightCssPx: 500, zoom: 2, center: pos(128, 128) });
  assert.deepEqual(worldToCanvas(pos(128, 128), viewport), { x: 500, y: 250 });
  assert.deepEqual(worldToCanvas(pos(130, 126), viewport), { x: 504, y: 254 });

  const canonical = Object.freeze({ position: pos(128, 128), velocityXQ16: 123, velocityYQ16: -456 });
  const before = canonicalHash(canonical);
  const panned = panViewport(viewport, 20, -10);
  const zoomed = zoomViewport(panned, 1.5);
  const higherDpr = createViewport({ ...viewport, devicePixelRatio: 2 });
  assert.equal(canonicalHash(canonical), before);
  assert.notDeepEqual(panned.center, viewport.center);
  assert.equal(zoomed.zoom, 3);
  assert.deepEqual(worldToCanvas(pos(130, 126), higherDpr), { x: 504, y: 254 });
  assert.equal(higherDpr.devicePixelRatio, 2);
  assert.equal(canonicalHash(canonical), before);
});

test('preview accumulation is bounded and reset/rebuild cannot retain stale records', () => {
  const accumulator = new PreviewAccumulator(3);
  const records = [
    deposition('ink', 'disc', 1, 1),
    deposition('filament', 'segment', 2, 2),
    deposition('dust', 'point', 3, 3),
    deposition('shard', 'segment', 4, 4)
  ];
  accumulator.appendMany(records);
  assert.equal(accumulator.size, 3);
  assert.equal(accumulator.diagnostics().totalDropped, 1);
  assert.deepEqual(accumulator.snapshot(), records.slice(1));

  accumulator.reset();
  assert.equal(accumulator.size, 0);
  assert.deepEqual(accumulator.snapshot(), []);

  accumulator.rebuild(records.slice(0, 2));
  assert.deepEqual(accumulator.snapshot(), records.slice(0, 2));
  assert.equal(accumulator.diagnostics().truncated, false);
});

test('buffer preparation batches points and segments with distinct material preview styles', () => {
  const records = [
    deposition('ink', 'disc', 10, 10),
    deposition('filament', 'segment', 12, 12),
    deposition('dust', 'point', 14, 14),
    deposition('shard', 'segment', 16, 16)
  ];
  const geometry = prepareDepositionGeometry(records, createViewport({ center: pos(12, 12), widthCssPx: 800, heightCssPx: 600 }));
  assert.equal(geometry.pointCount, 2);
  assert.equal(geometry.lineVertexCount, 4);
  assert.equal(geometry.points.length, 14);
  assert.equal(geometry.lines.length, 28);
  assert.ok(geometry.byteLength > 0);

  const colors = Object.values(MATERIAL_PREVIEW_STYLES).map((style) => style.rgba.join(','));
  assert.equal(new Set(colors).size, 4);
});

test('representative four-material frame preparation leaves canonical simulation hashes untouched', () => {
  const demo = createRendererDemoSimulation();
  const beforeState = demo.simulation.stateHash();
  const beforeDepositions = demo.simulation.depositionHash();
  const kinds = new Set(demo.simulation.depositions.map((record) => record.materialKind));
  assert.deepEqual([...kinds].sort(), ['dust', 'filament', 'ink', 'shard']);

  const frame = prepareFrameModel({
    depositions: demo.simulation.depositions,
    fieldCollection: demo.fieldCollection,
    emitters: demo.emitters
  }, createViewport({ center: pos(128, 128), widthCssPx: 1920, heightCssPx: 1080, zoom: 3 }));

  assert.ok(frame.artwork.pointCount > 0);
  assert.ok(frame.artwork.lineVertexCount > 0);
  assert.equal(frame.overlays.emitterCount, 4);
  assert.ok(frame.overlays.fieldCount >= 2);
  assert.equal(demo.simulation.stateHash(), beforeState);
  assert.equal(demo.simulation.depositionHash(), beforeDepositions);
});

test('WebGL2 absence fails actionably without touching canonical simulation state', () => {
  const demo = createRendererDemoSimulation();
  const before = demo.simulation.resultHash();
  const canvas = {
    getContext(type) {
      assert.equal(type, 'webgl2');
      return null;
    }
  };
  assert.throws(
    () => createWebGL2Renderer(canvas),
    (error) => error instanceof RendererUnavailableError && /WebGL2 is unavailable/.test(error.message)
  );
  assert.equal(demo.simulation.resultHash(), before);
});
