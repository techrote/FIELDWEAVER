import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qualify,SEED,TARGET_TICK} from './qualify.mjs';
test('Original 03 interval engine: normalized recipe, independent tiled canonical replay, PNG roundtrip',async()=>{
 const receipt=await qualify();
 assert.equal(receipt.seed,SEED);assert.equal(receipt.targetTick,TARGET_TICK);
 assert.equal(receipt.crop.widthPx,512);assert.equal(receipt.crop.heightPx,384);
});
