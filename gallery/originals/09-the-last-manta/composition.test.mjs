import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qualify,isArchived,emitArchive} from './qualify.mjs';

test('Original 09: canonical FW-012 recipe/replay/crop/tile and archived identity',async()=>{
  const archived=isArchived();
  const {receipt,payload}=await qualify({archived});
  assert.equal(receipt.seed,0x519af26d);
  assert.equal(receipt.targetTick,166);
  assert.equal(receipt.crop.widthPx,480);
  assert.equal(receipt.crop.heightPx,320);
  if(!archived){
    // Initial exact-head CI is our native Node software-render host.
    // Capture actual archive bytes for immutable repository admission;
    // final exact-head CI must re-run with all archives committed.
    console.log('FW9INITIAL_ARCHIVE_STAGE');
    emitArchive(payload);
  }
  console.log('FW9RECEIPT '+JSON.stringify(receipt));
});
