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


test('Original 08: candidate enters offline accepted-preset exhibition with exact archived CPU pixels',async()=>{
  const {mkdtemp,readFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {fileURLToPath}=await import('node:url');
  const {runCli}=await import('../../../scripts/review-gallery.mjs');
  const folder=await mkdtemp(join(tmpdir(),'fw-original08-curation-'));
  try{
    const output=join(folder,'review.html');
    const provenance=fileURLToPath(new URL('./the-vacant-rooms.provenance.json',import.meta.url));
    const result=await runCli([
      '--out',output,
      '--preset','operator-atlas',
      '--preset','timeline-pulse',
      '--provenance',provenance
    ]);
    assert.deepEqual(result.entries.map(x=>x.accepted),[true,true,false]);
    assert.equal(result.entries[2].recipeHash,'3a2c43dd7f49d9aa');
    assert.equal(result.entries[2].rawRgbaHash,'56286fc4c1a47bb8');
    const html=await readFile(output,'utf8');
    assert.match(html,/UNMERGED CANDIDATE/);
    assert.match(html,/ACCEPTED PRESET/);
    assert.match(html,/download="fieldweaver-work-3.recipe.json"/);
    assert.match(html,/Identity, lineage and exact framing/);
    assert.doesNotMatch(html,/<script\b|<iframe\b|src="https?:|href="https?:/i);
    const images=[...html.matchAll(/<img[^>]+src="data:image\/png;base64,([^"]+)"/g)];
    assert.equal(images.length,3,'two accepted CPU proofs and one proposed original');
    const archived=await readFile(new URL('./the-vacant-rooms.png',import.meta.url));
    assert.deepEqual(Buffer.from(images[2][1],'base64'),archived,
      'Review entry must show exact source-archived canonical pixels');
  }finally{
    await rm(folder,{recursive:true,force:true});
  }
});
