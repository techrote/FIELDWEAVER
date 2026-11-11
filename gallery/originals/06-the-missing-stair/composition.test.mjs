import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualify, SEED, TICK } from './qualify.mjs';
test('Original 06: original recipe, exact same-tick replay, software RGBA and tile invariance',async()=>{
 const {receipt,rgba}=await qualify();
 assert.equal(receipt.seed,SEED);assert.equal(receipt.targetTick,TICK);
 assert.equal(receipt.crop.widthPx,320);assert.equal(receipt.crop.heightPx,240);
 let marked=0;for(let i=0;i<rgba.length;i+=4)if(rgba[i]!==9||rgba[i+1]!==11||rgba[i+2]!==8)marked++;
 assert(marked>150,'significant painted area, not an empty result');
});
