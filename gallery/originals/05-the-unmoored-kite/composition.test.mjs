import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePngRgba } from '../../../src/export/index.js';
import { qualify, EXPECTED_RECIPE_HASH } from './qualify.mjs';
test('Original 05: archived canonical bytes, provenance, normalized recipe and replay are exact',async()=>{
 const {receipt,png}=await qualify();
 assert.equal(receipt.recipeHash,EXPECTED_RECIPE_HASH);
 assert.equal(receipt.crop.widthPx,256);assert.equal(receipt.crop.heightPx,192);
 const {rgba}=decodePngRgba(png);
 let foreground=0;
 for(let i=0;i<rgba.length;i+=4)if(rgba[i]!==9||rgba[i+1]!==11||rgba[i+2]!==8)foreground++;
 assert(foreground>300,'canonical result must contain substantial visible marks');
 assert.equal(receipt.depositionCount,20451);
});
