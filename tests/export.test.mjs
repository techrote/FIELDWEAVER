import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { Q16_ONE } from '../src/core/numeric.js';
import { normalizeWorldPosition } from '../src/core/coordinates.js';
import { MutationEditorSession } from '../src/editor/index.js';
import {
  CANONICAL_RASTER_VERSION,
  MAX_ASSEMBLED_PIXELS,
  createCanonicalExport,
  decodePngRgba,
  iterateRasterTiles,
  rasterizeDepositions,
  rasterizeDepositionsTiled,
  rawRgbaHash
} from '../src/export/index.js';

function world(xQ16, yQ16) {
  return normalizeWorldPosition({ chunkX: 0, chunkY: 0, localX: xQ16, localY: yQ16 });
}

function goldenCrop() {
  return {
    widthPx: 8,
    heightPx: 8,
    center: world(4 * Q16_ONE, 4 * Q16_ONE),
    unitsPerPixelQ16: Q16_ONE
  };
}

function goldenDepositions() {
  return [
    {
      tick: 0, sequence: 0, materialKind: 'ink', primitive: 'disc',
      from: world(5 * Q16_ONE / 2, 13 * Q16_ONE / 2),
      to: world(5 * Q16_ONE / 2, 13 * Q16_ONE / 2),
      radiusQ16: Q16_ONE / 2, strengthQ16: Q16_ONE
    },
    {
      tick: 1, sequence: 1, materialKind: 'filament', primitive: 'segment',
      from: world(3 * Q16_ONE / 2, 9 * Q16_ONE / 2),
      to: world(13 * Q16_ONE / 2, 9 * Q16_ONE / 2),
      radiusQ16: Q16_ONE / 4, strengthQ16: 3 * Q16_ONE / 4
    },
    {
      tick: 2, sequence: 2, materialKind: 'dust', primitive: 'point',
      from: world(7 * Q16_ONE / 2, 7 * Q16_ONE / 2),
      to: world(7 * Q16_ONE / 2, 7 * Q16_ONE / 2),
      radiusQ16: Q16_ONE / 8, strengthQ16: Q16_ONE / 2
    },
    {
      tick: 3, sequence: 3, materialKind: 'shard', primitive: 'segment',
      from: world(11 * Q16_ONE / 2, 3 * Q16_ONE / 2),
      to: world(11 * Q16_ONE / 2, 13 * Q16_ONE / 2),
      radiusQ16: 10923, strengthQ16: Q16_ONE
    },
    {
      tick: 4, sequence: 4, materialKind: 'ink', primitive: 'disc',
      from: world(Q16_ONE / 2, Q16_ONE / 2),
      to: world(Q16_ONE / 2, Q16_ONE / 2),
      radiusQ16: Q16_ONE / 2, strengthQ16: Q16_ONE,
      colorRgba8: [255, 255, 255, 128]
    }
  ];
}

function pixelAt(rgba, width, x, y) {
  const offset = (y * width + x) * 4;
  return Array.from(rgba.subarray(offset, offset + 4));
}

test('golden software raster covers all materials, compositing, crop edges, and canonical sequence order', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/fw-012-golden.json', import.meta.url), 'utf8'));
  assert.equal(fixture.version, CANONICAL_RASTER_VERSION);
  const depositions = goldenDepositions();
  const rgba = rasterizeDepositions(depositions, goldenCrop());
  assert.equal(rawRgbaHash(rgba), fixture.rawRgbaHash);
  for (const sample of fixture.samples) {
    assert.deepEqual(pixelAt(rgba, fixture.widthPx, sample.x, sample.y), sample.rgba, sample.meaning);
  }

  const shuffled = rasterizeDepositions([...depositions].reverse(), goldenCrop());
  assert.deepEqual(shuffled, rgba, 'deposition array order cannot override canonical numeric sequence');
  assert.throws(() => rasterizeDepositions([...depositions, { ...depositions[0] }], goldenCrop()), /Duplicate deposition sequence/);
});

test('tiled rasterization is byte-identical to single-pass rasterization across awkward tile seams', () => {
  const depositions = goldenDepositions();
  const crop = goldenCrop();
  const single = rasterizeDepositions(depositions, crop);
  for (const [tileWidthPx, tileHeightPx] of [[1, 1], [3, 2], [5, 7], [8, 3]]) {
    const tiled = rasterizeDepositionsTiled(depositions, crop, { tileWidthPx, tileHeightPx });
    assert.deepEqual(tiled, single, `${tileWidthPx}x${tileHeightPx} tiles`);
  }
});

test('large crops have a bounded-memory tile iterator while full assembly fails explicitly', () => {
  const crop = {
    widthPx: 100_000,
    heightPx: 100_000,
    center: world(0, 0),
    unitsPerPixelQ16: Q16_ONE
  };
  const iterator = iterateRasterTiles([], crop, { tileWidthPx: 32, tileHeightPx: 16 });
  const first = iterator.next();
  assert.equal(first.done, false);
  assert.equal(first.value.rgba.length, 32 * 16 * 4);
  assert.equal(first.value.x, 0);
  assert.equal(first.value.y, 0);
  assert(MAX_ASSEMBLED_PIXELS < crop.widthPx * crop.heightPx);
  assert.throws(() => rasterizeDepositionsTiled([], crop), /use iterateRasterTiles\(\)/);
});

test('canonical PNG packaging decodes exactly to the raw RGBA oracle', () => {
  const rgba = rasterizeDepositions(goldenDepositions(), goldenCrop());
  const editor = new MutationEditorSession();
  const result = createCanonicalExport(editor.currentRecipe(), {
    targetTick: 0,
    crop: goldenCrop(),
    tileWidthPx: 3,
    tileHeightPx: 2
  });
  const decoded = decodePngRgba(result.png);
  assert.equal(decoded.widthPx, 8);
  assert.equal(decoded.heightPx, 8);
  assert.deepEqual(decoded.rgba, result.rgba);
  assert.equal(rawRgbaHash(decoded.rgba), result.rawRgbaHash);
  assert.throws(() => decodePngRgba(Uint8Array.of(1, 2, 3, 4)), /PNG signature/);
  assert.equal(rgba.length, 8 * 8 * 4);
});

test('repeated recipe exports are deterministic and provenance is sufficient to reproduce the canonical image', () => {
  const editor = new MutationEditorSession({ agentCapacity: 1024, maxDepositions: 100_000 });
  editor.runTicks(12);
  const recipe = editor.currentRecipe();
  const crop = {
    widthPx: 48,
    heightPx: 32,
    center: world(128 * Q16_ONE, 128 * Q16_ONE),
    unitsPerPixelQ16: Q16_ONE
  };
  const options = { targetTick: 12, crop, agentCapacity: 1024, maxDepositions: 100_000, tileWidthPx: 11, tileHeightPx: 7 };
  const first = createCanonicalExport(recipe, options);
  const second = createCanonicalExport(recipe, { ...options, tileWidthPx: 48, tileHeightPx: 32 });
  assert.equal(first.rawRgbaHash, second.rawRgbaHash);
  assert.deepEqual(first.rgba, second.rgba);
  assert.equal(first.provenance.recipeHash, first.recipeHash);
  assert.equal(first.provenance.seed, recipe.seed);
  assert.equal(first.provenance.schemaVersion, recipe.schemaVersion);
  assert.equal(first.provenance.engineVersion, recipe.engineVersion);
  assert.equal(first.provenance.targetTick, 12);
  assert.equal(first.provenance.rawRgbaHash, first.rawRgbaHash);
  assert.deepEqual(first.provenance.crop, crop);
  assert.deepEqual(first.provenance.lineage, recipe.lineage);
  assert.equal(first.provenance.stateHash, second.provenance.stateHash);
  assert.equal(first.provenance.depositionHash, second.provenance.depositionHash);
  assert.match(first.provenanceJson, new RegExp(first.rawRgbaHash));
});

test('canonical export is renderer-independent and deposition exhaustion fails instead of falling back to a framebuffer', async () => {
  const source = await Promise.all([
    readFile(new URL('../src/export/raster.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/export/package.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/export/png.js', import.meta.url), 'utf8')
  ]);
  for (const text of source) {
    assert.doesNotMatch(text, /WebGL|framebuffer|\.\.\/renderer\//i);
  }
  const editor = new MutationEditorSession();
  assert.throws(() => createCanonicalExport(editor.currentRecipe(), {
    targetTick: 4,
    crop: { widthPx: 8, heightPx: 8, center: world(128 * Q16_ONE, 128 * Q16_ONE), unitsPerPixelQ16: Q16_ONE },
    maxDepositions: 1
  }), /Canonical deposition capacity exhausted/);
});
