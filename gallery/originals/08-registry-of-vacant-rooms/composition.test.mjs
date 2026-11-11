import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qualify,isArchived,emitArchive} from './qualify.mjs';
test('Original 08: deterministic FW-012 composition, alternate tiling, PNG decode and recipe roundtrip',async()=>{
  const archived=isArchived();
  const {receipt,payload}=await qualify({archived});
  assert.equal(receipt.seed,0x6da27f19);
  assert.equal(receipt.targetTick,162);
  assert.equal(receipt.crop.widthPx,432);
  assert.equal(receipt.crop.heightPx,304);
  if(process.env.CI==='true'&&!archived&&process.version.startsWith('v22.'))
    emitArchive(payload);
  console.log('FW8RECEIPT '+JSON.stringify(receipt));
});
