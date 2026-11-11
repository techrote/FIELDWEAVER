import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createCanonicalExport, decodePngRgba, encodePngRgba, rawRgbaHash } from '../../../src/export/index.js';
import { getBuiltinPreset } from '../../../src/presets/index.js';
import { mutateRecipe, readMutationLineage } from '../../../src/mutation/index.js';
import { parseRecipe, recipeHash, serializeRecipe } from '../../../src/recipe/index.js';

// All proof data comes from FW-012 CPU exports. Never substitute a WebGL preview.
const ROOT = dirname(fileURLToPath(import.meta.url));
const PREFIX = 'gallery/variants/05-faulted-confluence/';
const SOURCE_MAIN = 'a940b79f8ae87a3f8f475283155bc97fadc62313';
const PRESET = 'operator-atlas';
const PARENT_HASH = 'ab6f4e5af5842f3a';
const ROOT_SEED = 0x6b7e2a95;
const TARGET_TICK = 164, EARLY_TICK = 30, SAMPLES = 24;
const parent = getBuiltinPreset(PRESET);
const CROP = Object.freeze({
  widthPx: 192, heightPx: 144,
  center: {chunkX: 0, chunkY: 0, localX: 122 * 65536, localY: 122 * 65536},
  unitsPerPixelQ16: 49152
});
const OPTIONS = {crop: CROP, targetTick: TARGET_TICK, agentCapacity: 4096,
  maxDepositions: 250000, tileWidthPx: 31, tileHeightPx: 23};
const BG = [9,11,8];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exportAt = (recipe,tick=TARGET_TICK,extra={}) =>
  createCanonicalExport(recipe,{...OPTIONS,targetTick:tick,...extra});
const configFor = index => {
  const scope = ['all','emitters','fields','order','all'][index%5];
  return {mutationSeed:ROOT_SEED,siblingIndex:index,scope,intensity:'bold',
    operationCount:scope==='all'?6:scope==='fields'?2:1};
};
function silhouette(rgba) {
  const mask = new Uint8Array(rgba.length/4);
  let occupied=0, spread=0;
  for (let i=0;i<mask.length;i++) {
    const p=i*4;
    mask[i]=+(rgba[p]!==BG[0]||rgba[p+1]!==BG[1]||rgba[p+2]!==BG[2]);
    occupied+=mask[i];
  }
  for(let cy=0;cy<9;cy++)for(let cx=0;cx<12;cx++) {
    let found=false;
    for(let y=cy*16;y<(cy+1)*16&&!found;y++)
      for(let x=cx*16;x<(cx+1)*16;x++)
        if(mask[y*192+x]){found=true;break;}
    spread+=+found;
  }
  return {mask,occupied,spread};
}
function xor(a,b) {
  assert.equal(a.length,b.length);
  let n=0;for(let i=0;i<a.length;i++)n+=+(a[i]!==b[i]);
  return n;
}
function contact(exports) {
  const widthPx=3*192+4*6,heightPx=2*144+3*6;
  const rgba=new Uint8Array(widthPx*heightPx*4);
  for(let i=0;i<rgba.length;i+=4){rgba[i]=20;rgba[i+1]=22;rgba[i+2]=20;rgba[i+3]=255;}
  exports.forEach((entry,index)=>{
    const ox=6+(index%3)*198,oy=6+Math.floor(index/3)*150;
    for(let y=0;y<144;y++)
      rgba.set(entry.rgba.subarray(y*192*4,(y+1)*192*4),((oy+y)*widthPx+ox)*4);
  });
  return {widthPx,heightPx,rgba,png:encodePngRgba(rgba,widthPx,heightPx)};
}
const file=(path,data)=>({path:PREFIX+path,bytes:Buffer.from(data)});
function emit(item) {
  const b64=item.bytes.toString('base64'),parts=Math.ceil(b64.length/3000);
  console.log('FW_CONFLUENCE_META '+JSON.stringify({path:item.path,size:item.bytes.length,
    sha256:sha256(item.bytes),parts}));
  for(let n=0;n<parts;n++)console.log('FW_CONFLUENCE_DATA '+JSON.stringify({
    path:item.path,index:n,data:b64.slice(n*3000,(n+1)*3000)}));
}
function build(){
  assert.equal(recipeHash(parent.recipe),PARENT_HASH,'accepted parent changed');
  assert.equal(parent.recipeHash,PARENT_HASH);
  const parentProof=exportAt(parent.recipe),parentShape=silhouette(parentProof.rgba);
  const samples=[];
  for(let index=0;index<SAMPLES;index++) {
    const config=configFor(index);
    const bridgeConfig={mutationSeed:ROOT_SEED^0x418b322b,siblingIndex:index,scope:'all',intensity:'bold',operationCount:6};
    const bridge=mutateRecipe(parent.recipe,bridgeConfig);
    const mutation=mutateRecipe(bridge.recipe,config);
    const output=exportAt(mutation.recipe),shape=silhouette(output.rgba);
    samples.push({index,config,bridgeConfig,bridge,mutation,output,shape,
      parentXor:xor(shape.mask,parentShape.mask),
      lineage:readMutationLineage(mutation.recipe)});
  }
  assert.equal(new Set(samples.map(s=>s.mutation.childRecipeHash)).size,SAMPLES);
  const ranked=[...samples].sort((a,b)=>
    (b.parentXor*5+b.shape.spread*28+b.shape.occupied/5)-
    (a.parentXor*5+a.shape.spread*28+a.shape.occupied/5)||a.index-b.index);
  const finalists=[];
  for(const sample of ranked) {
    if(sample.shape.occupied<80||sample.parentXor<70||sample.shape.spread<5
       ||sample.shape.occupied>8000
       ||finalists.some(f=>f.output.rawRgbaHash===sample.output.rawRgbaHash
           ||xor(f.shape.mask,sample.shape.mask)<110)) continue;
    finalists.push(sample);
    if(finalists.length===5)break;
  }
  assert.equal(finalists.length,5,'require five morphology-separated finalists');
  for(const item of finalists) {
    const early=exportAt(item.mutation.recipe,EARLY_TICK);
    item.temporalXor=xor(silhouette(early.rgba).mask,item.shape.mask);
    item.earlyRawRgbaHash=early.rawRgbaHash;
  }
  // Editorial choice can be changed only after direct inspection of the
  // canonical sheet; the committed manifest records the chosen sibling.
  const chosen=finalists[0];
  assert.equal(chosen.index,16,'pinned artistic selection changed');
  assert.equal(chosen.output.rawRgbaHash,'c5a30c3fbf9025a4','canonical selected RGBA identity changed');
  const sheet=contact([parentProof,...finalists.map(x=>x.output)]);
  assert.deepEqual(decodePngRgba(sheet.png).rgba,sheet.rgba);
  const manifest={
    version:'fw-variant-atlas-v1',
    title:'Faulted Confluence — double-generation field displacement',
    sourceMainCommit:SOURCE_MAIN,
    parent:{presetId:PRESET,recipeHash:parent.recipeHash,rawRgbaHash:parentProof.rawRgbaHash},
    mutationVersion:'fw-mutation-v1',mutationSeed:ROOT_SEED,
    targetTick:TARGET_TICK,earlyTick:EARLY_TICK,crop:CROP,
    agentCapacity:OPTIONS.agentCapacity,maxDepositions:OPTIONS.maxDepositions,
    candidateCount:SAMPLES,
    selectionCriteria:'Canonical decoded RGBA uniqueness; >=80 occupied pixels, >=5 occupied 16px cells, parent silhouette XOR >=70, finalist pairwise silhouette XOR >=110; hue-only changes cannot qualify.',
    candidates:samples.map(s=>({
      siblingIndex:s.index,config:s.config,bridgeConfig:s.bridgeConfig,bridgeRecipeHash:s.bridge.childRecipeHash,recipeHash:s.mutation.childRecipeHash,
      rawRgbaHash:s.output.rawRgbaHash,occupiedPixels:s.shape.occupied,
      coveredCells:s.shape.spread,parentSilhouetteXor:s.parentXor,
      operationTypes:s.mutation.operations.map(x=>x.type)})),
    finalists:finalists.map((s,i)=>({
      panel:i+2,siblingIndex:s.index,config:s.config,bridgeRecipeHash:s.bridge.childRecipeHash,
      lineageIdentity:s.lineage.childIdentity,recipeHash:s.mutation.childRecipeHash,
      rawRgbaHash:s.output.rawRgbaHash,stateHash:s.output.stateHash,
      depositionHash:s.output.depositionHash,resultHash:s.output.resultHash,
      occupiedPixels:s.shape.occupied,coveredCells:s.shape.spread,
      parentSilhouetteXor:s.parentXor,earlyLateSilhouetteXor:s.temporalXor,
      earlyRawRgbaHash:s.earlyRawRgbaHash,
      operationTypes:s.mutation.operations.map(x=>x.type)})),
    contactSheet:{widthPx:sheet.widthPx,heightPx:sheet.heightPx,
      displayOnly:true,rawRgbaHash:rawRgbaHash(sheet.rgba)},
    selection:{siblingIndex:chosen.index,
      rationale:"Actual six-panel FW-012 CPU contact sheet and selected PNG inspected. Sibling 16 (panel 2) displaces the accepted parent diagonal into an almost horizontal two-bend cyan carrier, with an ochre speckle above, a clipped violet register high left and a small red-green signal below. Dark negative space dominates. Panels 3 and 4 remain arch-like, panel 5 breaks into separated fragments, and panel 6 trails into a longer multicolour diagonal. The horizontal carrier deliberately diverges from the opposing arcs of Countercurrent Canticle and Negative Loom."}

  };
  const note=["# Faulted Confluence — the suspended carrier","","Two generations of topology-safe FW-011 mutation applied to the immutable accepted Operator Atlas preset. The first generation performs a six-operator bold compound mutation, then a second scoped mutation. Twenty-four independent and replayable branches explore how stacked field and emitter disruptions can reorganize a familiar current.","","## Selected composition","","Sibling 16 (contact-sheet panel 2) was chosen after actual inspection of the FW-012 CPU canonical contact sheet and the exact selected PNG, not merely its morphology rank. The original down-slanting cyan arc becomes a suspended, nearly horizontal cyan two-bend ribbon with a light inner seam. A small ochre particulate cluster above, a clipped violet strip high left, and a single vivid red-green registration mark below supply restrained counterweights. Much of the plate remains black by intention.","","The other finalists retain a tall cyan arch (panel 3), a downturned hook (panel 4), a disconnected set of fragments (panel 5), or a diagonal rainbow exit (panel 6). Unlike the previously submitted Countercurrent Canticle and Negative Loom, this piece has no opposing rising arc; its empty lower-right field is part of its formal tension.","","## Canonical lineage and use","","Accepted, unmodified parent: operator-atlas; recipe hash ab6f4e5af5842f3a.","Stage-one mutation seed 0x2af518be, stage-two seed 0x6b7e2a95, 24 sibling indexes (0 through 23), explicit per-index scopes, bold intensity and recorded operations.","Selected bridge recipe is selected-bridge.recipe.json. Its lineage points to Operator Atlas. selected.recipe.json is the loadable final child whose lineage points to that exact bridge hash. The full 24-candidate ledger and all rejected/finalist morphology values are in atlas.manifest.json.","FW-012 canonical CPU export at tick 164, early comparison tick 30, 192x144 pixels, centre world (122,122) in chunk (0,0), 0.75 world units per pixel; 4096-agent, 250000-deposition bounds; initial tile 31x23 and alternative tile 41x37.","Open atlas.png for panel 1 parent and panels 2-6 five diversity-filtered descendants. The sheet is a display-only assembly of real separately rendered CPU PNGs. The authoritative winner is selected.png, backed by selected.provenance.json and the normalized selected.recipe.json.","","## Verification","","Actual source: passing Node 22 and Node 24 CI workflow 42952456955; retrieved Node 24 frame bytes from job 130299696933 and confirmed all 18 transfer receipts agree with Node 22 job 130299696490. The selected canonical RGBA8 FNV hash is c5a30c3fbf9025a4. No WebGL framebuffer or screenshot is used as an export oracle.","Reproduction: npm run verify, or node --test gallery/variants/05-faulted-confluence/atlas.test.mjs. The exact deterministic test recreates all 18 art assets, checks import/export and tile equivalence, and rejects any archived byte mismatch.","Draft for Integration review; no previous art or core code has been changed.",""].join('\n');
  const files=[
    file('README.md',note),file('atlas.manifest.json',JSON.stringify(manifest,null,2)+'\n'),
    file('parent.png',parentProof.png),file('atlas.png',sheet.png),
    file('selected-bridge.recipe.json',serializeRecipe(chosen.bridge.recipe))
  ];
  finalists.forEach((s,i)=>{
    const label=String(i+1).padStart(2,'0');
    files.push(file('candidates/'+label+'.recipe.json',serializeRecipe(s.mutation.recipe)));
    files.push(file('candidates/'+label+'.png',s.output.png));
  });
  files.push(file('selected.recipe.json',serializeRecipe(chosen.mutation.recipe)));
  files.push(file('selected.png',chosen.output.png));
  files.push(file('selected.provenance.json',chosen.output.provenanceJson));
  const bridgeImported=parseRecipe(serializeRecipe(chosen.bridge.recipe));
  assert.equal(recipeHash(bridgeImported),chosen.bridge.childRecipeHash);
  assert.equal(readMutationLineage(bridgeImported).parentRecipeHash,PARENT_HASH);
  assert.equal(chosen.lineage.parentRecipeHash,chosen.bridge.childRecipeHash);
  const imported=parseRecipe(serializeRecipe(chosen.mutation.recipe));
  assert.equal(recipeHash(imported),chosen.mutation.childRecipeHash);
  assert.equal(readMutationLineage(imported).childIdentity,chosen.lineage.childIdentity);
  const replay=exportAt(imported);
  assert.deepEqual(replay.rgba,chosen.output.rgba);
  assert.equal(replay.rawRgbaHash,chosen.output.rawRgbaHash);
  const alternate=exportAt(imported,TARGET_TICK,{tileWidthPx:41,tileHeightPx:37});
  assert.deepEqual(alternate.rgba,chosen.output.rgba);
  assert.deepEqual(decodePngRgba(alternate.png).rgba,alternate.rgba);
  return {files,manifest};
}
test('Faulted Confluence — immutable parent, real 30-child search, exact canonical atlas proof',async()=>{
  const {files,manifest}=build();
  let committed=false;
  try {await stat(join(ROOT,'atlas.manifest.json'));committed=true;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(!committed) {
    console.log('FW_CONFLUENCE_BOOTSTRAP '+JSON.stringify({
      parent:manifest.parent,seed:manifest.mutationSeed,tick:manifest.targetTick,
      candidateCount:manifest.candidateCount,finalists:manifest.finalists,
      selection:manifest.selection}));
    for(const f of files)emit(f);
  } else {
    for(const f of files)assert.deepEqual(
      await readFile(join(ROOT,f.path.slice(PREFIX.length))),f.bytes,
      f.path+' changed versus freshly regenerated FW-012 canonical source');
    console.log('FW_CONFLUENCE_VERIFIED '+JSON.stringify({
      fileCount:files.length,selection:manifest.selection,
      finalists:manifest.finalists.map(f=>[f.siblingIndex,f.rawRgbaHash])}));
  }
});
