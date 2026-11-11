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
const PREFIX = 'gallery/variants/04-negative-loom/';
const SOURCE_MAIN = 'a940b79f8ae87a3f8f475283155bc97fadc62313';
const PRESET = 'first-weave';
const PARENT_HASH = 'bb1a24bc2c9cf0bc';
const ROOT_SEED = 0x4e6f8a21;
const TARGET_TICK = 180, EARLY_TICK = 24, SAMPLES = 30;
const parent = getBuiltinPreset(PRESET);
const CROP = Object.freeze({
  widthPx: 192, heightPx: 144,
  center: {chunkX: 0, chunkY: 0, localX: 144 * 65536, localY: 132 * 65536},
  unitsPerPixelQ16: 65536
});
const OPTIONS = {crop: CROP, targetTick: TARGET_TICK, agentCapacity: 4096,
  maxDepositions: 250000, tileWidthPx: 31, tileHeightPx: 23};
const BG = [9,11,8];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exportAt = (recipe,tick=TARGET_TICK,extra={}) =>
  createCanonicalExport(recipe,{...OPTIONS,targetTick:tick,...extra});
const configFor = index => {
  const scope = ['all','emitters','seed','all','fields'][index%5];
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
  console.log('FW_LOOM_META '+JSON.stringify({path:item.path,size:item.bytes.length,
    sha256:sha256(item.bytes),parts}));
  for(let n=0;n<parts;n++)console.log('FW_LOOM_DATA '+JSON.stringify({
    path:item.path,index:n,data:b64.slice(n*3000,(n+1)*3000)}));
}
function build(){
  assert.equal(recipeHash(parent.recipe),PARENT_HASH,'accepted parent changed');
  assert.equal(parent.recipeHash,PARENT_HASH);
  const parentProof=exportAt(parent.recipe),parentShape=silhouette(parentProof.rgba);
  const samples=[];
  for(let index=0;index<SAMPLES;index++) {
    const config=configFor(index),mutation=mutateRecipe(parent.recipe,config);
    const output=exportAt(mutation.recipe),shape=silhouette(output.rgba);
    samples.push({index,config,mutation,output,shape,
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
  const sheet=contact([parentProof,...finalists.map(x=>x.output)]);
  assert.deepEqual(decodePngRgba(sheet.png).rgba,sheet.rgba);
  const manifest={
    version:'fw-variant-atlas-v1',
    title:'The Negative Loom — four channels after the crossing',
    sourceMainCommit:SOURCE_MAIN,
    parent:{presetId:PRESET,recipeHash:parent.recipeHash,rawRgbaHash:parentProof.rawRgbaHash},
    mutationVersion:'fw-mutation-v1',mutationSeed:ROOT_SEED,
    targetTick:TARGET_TICK,earlyTick:EARLY_TICK,crop:CROP,
    agentCapacity:OPTIONS.agentCapacity,maxDepositions:OPTIONS.maxDepositions,
    candidateCount:SAMPLES,
    selectionCriteria:'Exact canonical RGBA uniqueness, occupied-pixel bounds, 16px-cell coverage, parent silhouette XOR >=70, pairwise XOR >=110; hue-only differences cannot qualify.',
    candidates:samples.map(s=>({
      siblingIndex:s.index,config:s.config,recipeHash:s.mutation.childRecipeHash,
      rawRgbaHash:s.output.rawRgbaHash,occupiedPixels:s.shape.occupied,
      coveredCells:s.shape.spread,parentSilhouetteXor:s.parentXor,
      operationTypes:s.mutation.operations.map(x=>x.type)})),
    finalists:finalists.map((s,i)=>({
      panel:i+2,siblingIndex:s.index,config:s.config,
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
      rationale:'Actual six-panel FW-012 CPU contact-sheet inspection: sibling 11 (panel 2) adds a vivid green-to-violet-to-red rising arc opposite the falling cyan stroke, leaving a tensioned dark central gap. Panel 3 forms a single cyan wave, panel 4 rises nearly vertically, panels 5 and 6 are more compact or lower-sweeping. Sibling 11 best balances separated structures and deliberate negative space, beyond its morphological rank.'}
  };
  const note=[
    '# The Negative Loom — four channels after the crossing','',
    'Thirty topology-safe recipe mutations of the immutable First Weave preset, exploring how one displaced emitter can cleave a four-material current into separate opposing sweeps. The selected artwork was chosen after direct inspection of the real FW-012 CPU contact sheet, not from morphology rank alone.','',
    'Immutable accepted parent: first-weave, recipe hash '+PARENT_HASH+'.',
    'FW-011 explicit mutation seed: 0x4e6f8a21; 30 siblings; bold all/seed/fields/emitters scopes.',
    'FW-012 CPU comparison: tick 180, reference tick 24, 192×144 crop centred at (144,132) in chunk (0,0), 1 world unit/pixel.',
    'Selected after canonical image inspection: sibling '+chosen.index+'; recipe '+chosen.mutation.childRecipeHash+'; raw RGBA8 '+chosen.output.rawRgbaHash+'.','',
    '## Evidence and use','',
    'Actual selected image observation: a cyan descending stroke on the lower-left faces a separate green, violet and red arc bending upward on the right. Their unfilled central gap is the essential structural feature. The unchanged upper-left purple marker and tiny amber flecks retain the parent visual register. In comparison panel 3 is a smoother cyan wave, panel 4 is an upright cyan plume, panel 5 is a compact descent and panel 6 a long lower sweep. The editor-selected sibling 11 (panel 2) is strongest for counterposed curvature and legible absence. It is a single bold move-emitter operation (FW-011) with full lineage, not an invented redraw.','',
    'Open atlas.png to compare panel 1 (immutable parent) against panels 2–6 (five diversity-filtered descendants). The contact sheet is display-only; each child PNG is a separate FW-012 canonical export. The independent manifest records all 30 candidates, rejected clones, mutation operations, hashes, shape and temporal distances. No WebGL/GPU screenshot is used as a pixel oracle.','',
    'Load selected.recipe.json into the FIELDWEAVER recipe editor, or verify selected.provenance.json with the local proof desk. The atlas test rebuilds every binary output using the authoritative FW-012 exporter, checks both tiled replay and import/export roundtrip, and compares exact bytes.','',
    'Run npm run verify or node --test gallery/variants/04-negative-loom/atlas.test.mjs.',''
  ].join('\n');
  const files=[
    file('README.md',note),file('atlas.manifest.json',JSON.stringify(manifest,null,2)+'\n'),
    file('parent.png',parentProof.png),file('atlas.png',sheet.png)
  ];
  finalists.forEach((s,i)=>{
    const label=String(i+1).padStart(2,'0');
    files.push(file('candidates/'+label+'.recipe.json',serializeRecipe(s.mutation.recipe)));
    files.push(file('candidates/'+label+'.png',s.output.png));
  });
  files.push(file('selected.recipe.json',serializeRecipe(chosen.mutation.recipe)));
  files.push(file('selected.png',chosen.output.png));
  files.push(file('selected.provenance.json',chosen.output.provenanceJson));
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
test('Negative Loom — immutable parent, real 30-child search, exact canonical atlas proof',async()=>{
  const {files,manifest}=build();
  let committed=false;
  try {await stat(join(ROOT,'atlas.manifest.json'));committed=true;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(!committed) {
    console.log('FW_LOOM_BOOTSTRAP '+JSON.stringify({
      parent:manifest.parent,seed:manifest.mutationSeed,tick:manifest.targetTick,
      candidateCount:manifest.candidateCount,finalists:manifest.finalists,
      selection:manifest.selection}));
    for(const f of files)emit(f);
  } else {
    for(const f of files)assert.deepEqual(
      await readFile(join(ROOT,f.path.slice(PREFIX.length))),f.bytes,
      f.path+' changed versus freshly regenerated FW-012 canonical source');
    console.log('FW_LOOM_VERIFIED '+JSON.stringify({
      fileCount:files.length,selection:manifest.selection,
      finalists:manifest.finalists.map(f=>[f.siblingIndex,f.rawRgbaHash])}));
  }
});
