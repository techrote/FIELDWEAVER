import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qualify,isArchived} from './qualify.mjs';
test('Original 08: archived FW-012 PNG, provenance, independent replay and tile identity',async()=>{
  assert(isArchived(),'The complete immutable artwork evidence must be committed');
  const {receipt}=await qualify({archived:true});
  assert.equal(receipt.seed,0x6da27f19);
  assert.equal(receipt.targetTick,162);
  assert.equal(receipt.crop.widthPx,432);
  assert.equal(receipt.crop.heightPx,304);
  const golden={
    recipeHash:'3a2c43dd7f49d9aa',
    rawRgbaHash:'56286fc4c1a47bb8',
    stateHash:'6570a3a9701a96ee',
    depositionHash:'049bdf31300411f8',
    resultHash:'ededfccadff3acae',
    emitters:118,occupiedPixels:8452,depositionCount:11059
  };
  for(const [key,value] of Object.entries(golden))
    assert.equal(receipt[key],value,'golden mismatch: '+key);
});
