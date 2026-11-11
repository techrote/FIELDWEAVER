import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qualify,SEED,TARGET_TICK} from './qualify.mjs';
test('Original 04 pollen observatory: normalized recipe, explicit timeline, tiled FW-012 pixels',async()=>{
 const {receipt,png,provenanceJson}=await qualify();
 assert.equal(receipt.seed,SEED);assert.equal(receipt.targetTick,TARGET_TICK);
 assert.equal(receipt.crop.widthPx,576);assert.equal(receipt.crop.heightPx,384);
 // TEMPORARY TRANSFER: exact CPU output for authoring/archival. Remove after committing the PNG.
 if(process.env.GITHUB_ACTIONS==='true' && process.version.startsWith('v24.')){
  console.log('FW_ART04_RECEIPT='+Buffer.from(JSON.stringify(receipt)).toString('base64'));
  console.log('FW_ART04_PROVENANCE='+Buffer.from(provenanceJson).toString('base64'));
  console.log('FW_ART04_PNG='+Buffer.from(png).toString('base64'));
 }
});
