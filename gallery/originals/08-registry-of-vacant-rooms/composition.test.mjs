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
  const {createRoomsReview}=await import('./review.mjs');
  const folder=await mkdtemp(join(tmpdir(),'fw-original08-curation-'));
  try{
    const output=join(folder,'review.html');
    const result=await createRoomsReview(output);
    assert(result.url.startsWith('file:'),'Owner receives a local file URL');
    assert.equal(result.output,output);
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
    const recipeDownload=html.match(/<a href="data:application\/json;base64,([^"]+)" download="fieldweaver-work-3\.recipe\.json"/);
    assert(recipeDownload,'The proposed original must expose its importable recipe');
    const savedRecipe=JSON.parse(Buffer.from(recipeDownload[1],'base64').toString('utf8'));
    const sourceRecipe=JSON.parse(await readFile(new URL('./recipe.json',import.meta.url),'utf8'));
    assert.deepEqual(savedRecipe,sourceRecipe,'Downloaded review recipe must match archived author recipe');
    assert.deepEqual(Buffer.from(images[2][1],'base64'),archived,
      'Review entry must show exact source-archived canonical pixels');

    // Test the actual bytes offered to the owner, not just the displayed card.
    // A valid-looking href must not download a stale, divergent recipe/proof.
    const download=(filename)=>{
      const tag=[...html.matchAll(/<a [^>]*>/g)].map(match=>match[0])
        .find(value=>value.includes('download="'+filename+'"'));
      assert(tag,'Missing offline download: '+filename);
      const encoded=tag.match(/href="data:[^"]+;base64,([^"]+)"/);
      assert(encoded,'Non-embedded or malformed offline download: '+filename);
      return Buffer.from(encoded[1],'base64');
    };
    assert.deepEqual(download('fieldweaver-work-3.png'),archived,
      'Downloaded canonical PNG must match the archived author output');
    const sidecarBytes=download('fieldweaver-work-3.provenance.json');
    const sourceSidecar=await readFile(new URL('./the-vacant-rooms.provenance.json',import.meta.url));
    assert.deepEqual(sidecarBytes,sourceSidecar,
      'Downloaded provenance must match the archived canonical sidecar');

    // Re-import the *downloaded* recipe with the ordinary public validator,
    // then reproduce its advertised tick/crop and exact image identities.
    const {parseRecipe,serializeRecipe,recipeHash}=await import('../../../src/recipe/index.js');
    const {createCanonicalExport,decodePngRgba}=await import('../../../src/export/index.js');
    const imported=parseRecipe(Buffer.from(recipeDownload[1],'base64').toString('utf8'));
    assert.equal(serializeRecipe(imported),
      await readFile(new URL('./recipe.json',import.meta.url),'utf8'),
      'Public recipe import/roundtrip differs from the advertised download');
    assert.equal(recipeHash(imported),'3a2c43dd7f49d9aa');
    const provenance=JSON.parse(sidecarBytes.toString('utf8'));
    assert.deepEqual(provenance.recipe,imported);
    assert.equal(provenance.seed,0x6da27f19);
    assert.equal(provenance.targetTick,162);
    const replay=createCanonicalExport(imported,{
      targetTick:provenance.targetTick,crop:provenance.crop,
      backgroundRgba8:provenance.backgroundRgba8,
      agentCapacity:4096,maxDepositions:250000,
      tileWidthPx:59,tileHeightPx:41
    });
    assert.equal(replay.rawRgbaHash,'56286fc4c1a47bb8');
    assert.equal(replay.rawRgbaHash,provenance.rawRgbaHash);
    assert.equal(replay.stateHash,provenance.stateHash);
    assert.equal(replay.depositionHash,provenance.depositionHash);
    assert.equal(replay.resultHash,provenance.resultHash);
    assert.deepEqual(Buffer.from(replay.png),archived,
      'Editor-importable review download did not reproduce the canonical PNG');
    assert.deepEqual(decodePngRgba(replay.png).rgba,decodePngRgba(archived).rgba);
  }finally{
    await rm(folder,{recursive:true,force:true});
  }
});
