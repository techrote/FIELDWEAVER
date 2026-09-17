import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeWorldPosition } from '../src/core/coordinates.js';
import { Q16_ONE } from '../src/core/numeric.js';
import { MutationEditorSession } from '../src/editor/index.js';
import { iterateRasterTiles, rawRgbaHash } from '../src/export/index.js';
import { InfinitePlateEvaluator } from '../src/infinite/index.js';

function assembleTiles(tiles, widthPx, heightPx) {
  const rgba = new Uint8Array(widthPx * heightPx * 4);
  for (const tile of tiles) {
    for (let row = 0; row < tile.height; row += 1) {
      const sourceStart = row * tile.width * 4;
      const targetStart = ((tile.y + row) * widthPx + tile.x) * 4;
      rgba.set(tile.rgba.subarray(sourceStart, sourceStart + tile.width * 4), targetStart);
    }
  }
  return rgba;
}

test('regional canonical pixels are invariant to adversarial raster tile delivery order', () => {
  const editor = new MutationEditorSession({ agentCapacity: 1024, maxDepositions: 100_000 });
  const crop = {
    widthPx: 67,
    heightPx: 53,
    unitsPerPixelQ16: Q16_ONE,
    center: normalizeWorldPosition({ chunkX: 0, chunkY: 0, localX: 128 * Q16_ONE, localY: 128 * Q16_ONE })
  };
  const regional = new InfinitePlateEvaluator({ cacheChunks: 8 }).evaluate(editor.currentRecipe(), {
    targetTick: 12,
    crop,
    agentCapacity: 1024,
    maxDepositions: 100_000,
    tileWidthPx: 11,
    tileHeightPx: 7
  });
  const tiles = [...iterateRasterTiles(regional.depositions, crop, {
    backgroundRgba8: regional.backgroundRgba8,
    tileWidthPx: 11,
    tileHeightPx: 7
  })];
  const forward = assembleTiles(tiles, crop.widthPx, crop.heightPx);
  const reverse = assembleTiles([...tiles].reverse(), crop.widthPx, crop.heightPx);
  const oddThenEven = assembleTiles([
    ...tiles.filter((_, index) => index % 2 === 1),
    ...tiles.filter((_, index) => index % 2 === 0)
  ], crop.widthPx, crop.heightPx);

  assert.deepEqual(reverse, forward);
  assert.deepEqual(oddThenEven, forward);
  assert.equal(rawRgbaHash(forward), regional.rawRgbaHash);
  assert.equal(rawRgbaHash(reverse), regional.rawRgbaHash);
  assert.equal(rawRgbaHash(oddThenEven), regional.rawRgbaHash);
});
