import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualify, EXPECTED_RECIPE_HASH } from './qualify.mjs';
test('Original 05: normalized kite score, replay, CPU export, different tile sizes',async()=>{
 const {receipt,png}=await qualify();
 assert.equal(receipt.recipeHash,EXPECTED_RECIPE_HASH);
 assert.equal(receipt.crop.widthPx,256);assert.equal(receipt.crop.heightPx,192);
 console.log('FW05_RECEIPT='+JSON.stringify(receipt));
 const data=Buffer.from(png).toString('base64');
 for(let i=0;i<data.length;i+=2048)console.log('FW05_PNG_'+String(i/2048).padStart(4,'0')+'='+data.slice(i,i+2048));
});
