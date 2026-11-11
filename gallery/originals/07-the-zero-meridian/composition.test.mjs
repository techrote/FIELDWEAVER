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

test('Original 07: the offline owner review downloads the archived pixels, importable recipe and exact replay',async()=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {parseRecipe,serializeRecipe,recipeHash}=await import('../../../src/recipe/index.js');
 const {createCanonicalExport,decodePngRgba}=await import('../../../src/export/index.js');
 const {createZeroMeridianReview}=await import('./review.mjs');
 const folder=await mkdtemp(join(tmpdir(),'fw-original07-review-test-'));
 try{
  const output=join(folder,'review.html');
  const review=await createZeroMeridianReview(output);
  assert.equal(review.output,output);
  assert(review.url.startsWith('file:'),'review must be runnable offline');
  assert.deepEqual(review.entries.map(entry=>entry.accepted),[true,true,false]);
  assert.equal(review.entries[2].recipeHash,'002a783e5492a7d5');
  assert.equal(review.entries[2].rawRgbaHash,'20d0367ebe3a8d8e');
  const html=await readFile(output,'utf8');
  assert.match(html,/UNMERGED CANDIDATE/);
  assert.match(html,/ACCEPTED PRESET/);
  assert.match(html,/Identity, lineage and exact framing/);
  assert.doesNotMatch(html,/<script\b|<iframe\b|src="https?:|href="https?:/i);
  const images=[...html.matchAll(/<img[^>]+src="data:image\/png;base64,([^"]+)"/g)];
  assert.equal(images.length,3,'two accepted CPU controls and exactly one unadmitted candidate');
  const archivedPng=await readFile(new URL('./the-zero-meridian.png',import.meta.url));
  assert.deepEqual(Buffer.from(images[2][1],'base64'),archivedPng,
    'review image must be the actual archived canonical CPU PNG');

  function download(filename){
   const tag=[...html.matchAll(/<a [^>]*>/g)].map(match=>match[0])
     .find(value=>value.includes('download="'+filename+'"'));
   assert(tag,'Missing offline download '+filename);
   const encoded=tag.match(/href="data:[^"]+;base64,([^"]+)"/);
   assert(encoded,'Invalid embedded offline download '+filename);
   return Buffer.from(encoded[1],'base64');
  }
  const prefix='fieldweaver-work-3';
  assert.deepEqual(download(prefix+'.png'),archivedPng,
    'downloaded PNG diverges from displayed source-exact archived pixels');
  const savedRecipeText=download(prefix+'.recipe.json').toString('utf8');
  const sourceRecipeText=await readFile(new URL('./recipe.json',import.meta.url),'utf8');
  const recipe=parseRecipe(savedRecipeText);
  assert.equal(serializeRecipe(recipe),sourceRecipeText,
    'downloaded candidate recipe must roundtrip to the archived recipe');
  assert.equal(recipeHash(recipe),'002a783e5492a7d5');
  const sidecar=download(prefix+'.provenance.json');
  assert.deepEqual(sidecar,await readFile(new URL('./the-zero-meridian.provenance.json',import.meta.url)),
    'downloaded sidecar must be original canonical provenance');
  const provenance=JSON.parse(sidecar.toString('utf8'));
  assert.deepEqual(provenance.recipe,recipe);
  assert.equal(provenance.seed,0x5ce73a19);
  assert.equal(provenance.targetTick,154);
  assert.equal(provenance.crop.widthPx,352);
  assert.equal(provenance.crop.heightPx,288);
  const replay=createCanonicalExport(recipe,{
    targetTick:provenance.targetTick,crop:provenance.crop,
    backgroundRgba8:provenance.backgroundRgba8,
    agentCapacity:4096,maxDepositions:250000,
    tileWidthPx:59,tileHeightPx:43
  });
  assert.equal(replay.rawRgbaHash,'20d0367ebe3a8d8e');
  for(const field of ['rawRgbaHash','stateHash','depositionHash','resultHash'])
   assert.equal(replay[field],provenance[field],field+' differs from downloaded provenance');
  assert.deepEqual(Buffer.from(replay.png),archivedPng,
    're-imported exhibition recipe fails exact CPU canonical export');
  assert.deepEqual(decodePngRgba(replay.png).rgba,decodePngRgba(archivedPng).rgba);
 }finally{
  await rm(folder,{recursive:true,force:true});
 }
});
