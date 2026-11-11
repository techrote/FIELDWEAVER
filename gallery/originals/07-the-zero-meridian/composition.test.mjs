import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qualify} from './qualify.mjs';
test('Original 07: archived canonical FW-012 PNG/provenance/recipe and replay are exact',async()=>{
 const {receipt}=await qualify({archived:true});
 assert.equal(receipt.recipeHash,'002a783e5492a7d5');
 assert.equal(receipt.rawRgbaHash,'20d0367ebe3a8d8e');
 assert.equal(receipt.stateHash,'392c1dc87f4f73df');
 assert.equal(receipt.depositionHash,'6d062421d2acc4e2');
 assert.equal(receipt.resultHash,'9f3193bbf43aa545');
 assert.equal(receipt.seed,0x5ce73a19);
 assert.equal(receipt.targetTick,154);
 assert.equal(receipt.emitters,100);
 assert.equal(receipt.occupiedPixels,3041);
 assert.equal(receipt.depositionCount,9630);
});
