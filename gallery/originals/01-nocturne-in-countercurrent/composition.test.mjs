import assert from 'node:assert/strict';
import test from 'node:test';
import { qualifyArtwork, ARTWORK_ID, TARGET_TICK, EXPECTED_RECIPE_HASH } from './qualify.mjs';

test('FIELDWEAVER original: Nocturne in Countercurrent canonical qualification', async () => {
  const receipt = await qualifyArtwork();
  assert.equal(receipt.artwork, ARTWORK_ID);
  assert.equal(receipt.recipeHash, EXPECTED_RECIPE_HASH);
  assert.equal(receipt.targetTick, TARGET_TICK);
  assert.equal(receipt.crop.widthPx, 512);
  assert.equal(receipt.crop.heightPx, 320);
  assert.match(receipt.rawRgbaHash, /^[0-9a-f]{16}$/);
  assert.match(receipt.depositionHash, /^[0-9a-f]{16}$/);
  console.log('FW original qualification receipt: ' + JSON.stringify(receipt));
});
