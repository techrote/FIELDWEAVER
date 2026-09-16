import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { canonicalHash } from '../src/core/canonical.js';
import { Q16_ONE } from '../src/core/numeric.js';
import { createRendererDemoSimulation } from '../src/demo.js';
import {
  MATERIAL_PREVIEW_STYLES,
  PreviewAccumulator,
  PreviewGeometryCache,
  RendererUnavailableError,
  createViewport,
  createViewportTransform,
  createWebGL2Renderer,
  panViewport,
  prepareDepositionGeometry,
  prepareFrameModel,
  worldToCanvas,
  worldToClip,
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

function assertNear(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not within ${epsilon} of ${expected}`);
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

test('cached clip geometry can be transformed to a new viewport without per-record reprojection', () => {
  const reference = createViewport({ widthCssPx: 1000, heightCssPx: 500, zoom: 2, devicePixelRatio: 1, center: pos(128, 128) });
  const current = createViewport({ widthCssPx: 760, heightCssPx: 640, zoom: 4.5, devicePixelRatio: 1.75, center: pos(133, 124) });
  const transform = createViewportTransform(reference, current);
  for (const position of [pos(128, 128), pos(130, 126), pos(200, 90)]) {
    const cachedClip = worldToClip(position, reference);
    const directClip = worldToClip(position, current);
    assertNear(cachedClip.x * transform.clipScaleX + transform.clipOffsetX, directClip.x);
    assertNear(cachedClip.y * transform.clipScaleY + transform.clipOffsetY, directClip.y);
  }
  assert.equal(transform.artworkPointScale, current.zoom * current.devicePixelRatio);
  assert.equal(transform.overlayPointScale, current.devicePixelRatio);
});

test('preview accumulation is bounded and reset/rebuild cannot retain stale records', () => {
  const accumulator = new PreviewAccumulator(3);
  const records = [
    deposition('ink', 'disc', 1, 1),
    deposition('filament', 'segment', 2, 2),
    deposition('dust', 'point', 3, 3),
    deposition('shard', 'segment', 4, 4)
  ];
  const initialRevision = accumulator.revision;
  accumulator.appendMany(records);
  assert.equal(accumulator.size, 3);
  assert.ok(accumulator.revision > initialRevision);
  assert.equal(accumulator.diagnostics().totalDropped, 1);
  assert.deepEqual(accumulator.snapshot(), records.slice(1));

  accumulator.reset();
  assert.equal(accumulator.size, 0);
  assert.deepEqual(accumulator.snapshot(), []);

  accumulator.rebuild(records.slice(0, 2));
  assert.deepEqual(accumulator.snapshot(), records.slice(0, 2));
  assert.equal(accumulator.diagnostics().truncated, false);
});

test('unchanged deposition revision reuses prepared artwork across pan/zoom/resize', () => {
  const records = [
    deposition('ink', 'disc', 10, 10),
    deposition('filament', 'segment', 12, 12),
    deposition('dust', 'point', 14, 14),
    deposition('shard', 'segment', 16, 16)
  ];
  const accumulator = new PreviewAccumulator(16);
  accumulator.appendMany(records);
  const reference = createViewport({ center: pos(12, 12), widthCssPx: 800, heightCssPx: 600, zoom: 3 });
  const cache = new PreviewGeometryCache();
  const first = cache.rebuild(accumulator.snapshot(), accumulator.revision, reference);
  const artworkIdentity = first.artwork;
  assert.equal(first.rebuildCount, 1);

  const moved = zoomViewport(panViewport(reference, 140, -70), 1.7);
  const resized = createViewport({ ...moved, widthCssPx: 1200, heightCssPx: 720, devicePixelRatio: 2 });
  assert.equal(cache.matches(accumulator.revision), true);
  const reused = cache.snapshot(false);
  assert.strictEqual(reused.artwork, artworkIdentity);
  assert.equal(reused.rebuildCount, 1);
  const transform = createViewportTransform(reused.referenceViewport, resized);
  assert.ok(Number.isFinite(transform.clipScaleX));
  assert.ok(Number.isFinite(transform.clipOffsetY));

  accumulator.append(deposition('ink', 'disc', 18, 18));
  assert.equal(cache.matches(accumulator.revision), false);
  const rebuilt = cache.rebuild(accumulator.snapshot(), accumulator.revision, resized);
  assert.equal(rebuilt.rebuildCount, 2);
  assert.notStrictEqual(rebuilt.artwork, artworkIdentity);
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

test('browser interaction path coalesces rendering and does not full-rehash canonical depositions per view event', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(source, /const scheduleRender = \(\) =>/);
  assert.match(source, /if \(renderFrame !== 0\) return;/);
  assert.match(source, /requestAnimationFrame\(\(\) =>/);
  assert.match(source, /Object\.freeze\(\[\.\.\.demo\.simulation\.depositions\]\)/);
  assert.equal((source.match(/demo\.simulation\.resultHash\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(source, /renderer\.panByPixels\(dx, dy\);\s*render\(\);/);
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
