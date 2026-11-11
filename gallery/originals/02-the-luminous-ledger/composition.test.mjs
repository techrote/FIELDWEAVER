import assert from 'node:assert/strict';
import test from 'node:test';
import { qualifyArtwork, SEED, TARGET_TICK, ARTWORK_ID, EXPECTED_RECIPE_HASH, EXPECTED_RAW_RGBA_HASH, EXPECTED_RESULT_HASH } from './qualify.mjs';

test('FIELDWEAVER original: Luminous Ledger canonical archive and deterministic replay', async () => {
  const receipt = await qualifyArtwork();
  assert.equal(receipt.artwork, ARTWORK_ID);
  assert.equal(receipt.seed, SEED);
  assert.equal(receipt.targetTick, TARGET_TICK);
  assert.equal(receipt.recipeHash, EXPECTED_RECIPE_HASH);
  assert.equal(receipt.rawRgbaHash, EXPECTED_RAW_RGBA_HASH);
  assert.equal(receipt.resultHash, EXPECTED_RESULT_HASH);
  assert.equal(receipt.crop.widthPx, 448);
  assert.equal(receipt.crop.heightPx, 448);
  console.log('FW original archive qualification: ' + JSON.stringify(receipt));
});
