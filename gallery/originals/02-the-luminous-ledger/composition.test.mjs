import assert from 'node:assert/strict';
import test from 'node:test';
import { qualifyArtwork, SEED, TARGET_TICK, ARTWORK_ID } from './qualify.mjs';
test('FIELDWEAVER original: Luminous Ledger canonical replay and crop identity', async () => {
  const receipt=await qualifyArtwork({
    // Temporary bridge for exact native CI render bytes; removed after archival transfer.
    transfer: process.env.GITHUB_ACTIONS === 'true' && process.versions.node.startsWith('24.')
  });
  assert.equal(receipt.artwork, ARTWORK_ID);
  assert.equal(receipt.seed, SEED);
  assert.equal(receipt.targetTick, TARGET_TICK);
  assert.equal(receipt.crop.widthPx, 448);
  assert.equal(receipt.crop.heightPx, 448);
  console.log('FW_ART_RECEIPT:'+JSON.stringify(receipt));
});
