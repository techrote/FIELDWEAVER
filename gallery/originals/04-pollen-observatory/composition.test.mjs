import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qualify,SEED,TARGET_TICK} from './qualify.mjs';
test('Original 04 pollen observatory: normalized recipe, explicit timeline, tiled FW-012 pixels',async()=>{
 const {receipt}=await qualify();
 assert.equal(receipt.seed,SEED);assert.equal(receipt.targetTick,TARGET_TICK);
 assert.equal(receipt.crop.widthPx,576);assert.equal(receipt.crop.heightPx,384);

});
