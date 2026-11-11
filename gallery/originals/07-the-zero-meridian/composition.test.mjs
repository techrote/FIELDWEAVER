import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qualify} from './qualify.mjs';
test('Original 07: independent dial geometry, canonical software replay and artifact transfer',async()=>{
 const {receipt,recipeText,png,provenanceJson}=await qualify();
 assert(receipt.emitters>=70);
 assert(receipt.occupiedPixels>450);
 assert.equal(receipt.seed,0x5ce73a19);
 // Temporary, explicit, lossless CI transfer channel. Remove after archiving
 // native FW-012 artifacts; never treat the presentation as canonical.
 if(process.version.startsWith('v24.')){
  for(const [key,text] of [['RECIPE',Buffer.from(recipeText).toString('base64')],
     ['PNG',Buffer.from(png).toString('base64')],
     ['PROVENANCE',Buffer.from(provenanceJson).toString('base64')],
     ['RECEIPT',Buffer.from(JSON.stringify(receipt,null,2)+'\n').toString('base64')]]){
   const size=900,total=Math.ceil(text.length/size);
   for(let i=0;i<total;i++)console.log('FW07_TRANSFER '+key+' '+(i+1)+'/'+total+' '+text.slice(i*size,(i+1)*size));
  }
 }
});
