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

// FW-012 CPU software raster ONLY. No WebGL/GPU or synthetic thumbnails.
const ROOT = dirname(fileURLToPath(import.meta.url));
const PREFIX = 'gallery/variants/06-unwound-metronome/';
const MAIN = '0ddfd460a80b0bbf75f809e734d73e9011696fa7';
const PARENT_ID = 'timeline-pulse';
const PARENT_HASH = 'c94aed7bfc18a40d';
const BRIDGE_SEED = 0x91d0ca35;
const CHILD_SEED = 0x38ab21fe;
const COUNT = 18;
const TICK = 148;
const EARLY_TICK = 34;
const W = 192, H = 144;
const BACKGROUND = [9,11,8];
const CROP = Object.freeze({
  widthPx: W, heightPx: H,
  center: {chunkX: 0, chunkY: 0, localX: 128*65536, localY: 125*65536},
  unitsPerPixelQ16: 49152
});
const OPT = Object.freeze({crop:CROP,targetTick:TICK,agentCapacity:4096,
  maxDepositions:250000,tileWidthPx:31,tileHeightPx:23});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const proof = (recipe,tick=TICK,extra={}) =>
  createCanonicalExport(recipe,{...OPT,targetTick:tick,...extra});
const parent = getBuiltinPreset(PARENT_ID);
const config = index => {
  const scope = ['all','fields','emitters','seed','order','all'][index%6];
  return {mutationSeed:CHILD_SEED,siblingIndex:index,scope,intensity:'bold',
    operationCount:scope==='all'?6:scope==='fields'?2:1};
};
const bridgeConfig = index => ({
  mutationSeed:BRIDGE_SEED,siblingIndex:index,scope:'all',intensity:'bold',operationCount:6
});
function shapeOf(rgba) {
  const mask = new Uint8Array(W*H);
  const cells = new Uint8Array(12*9);
  const quadrants = [0,0,0,0];
  let occupied=0,minX=W,minY=H,maxX=0,maxY=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const i=y*W+x,p=i*4;
    if(rgba[p]===BACKGROUND[0]&&rgba[p+1]===BACKGROUND[1]&&rgba[p+2]===BACKGROUND[2])continue;
    mask[i]=1;occupied++;cells[Math.floor(y/16)*12+Math.floor(x/16)]=1;
    quadrants[(y>=H/2?2:0)+(x>=W/2?1:0)]++;
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);
    minY=Math.min(minY,y);maxY=Math.max(maxY,y);
  }
  return {mask,occupied,cells:cells.reduce((a,b)=>a+b,0),quadrants,
    bbox:occupied?{minX,minY,maxX,maxY}:null};
}
function xor(a,b) {
  assert.equal(a.length,b.length);
  let n=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])n++;
  return n;
}
function contact(entries) {
  const gap=8,cols=3,rows=2,width=cols*W+(cols+1)*gap,height=rows*H+(rows+1)*gap;
  const rgba=new Uint8Array(width*height*4);
  for(let p=0;p<rgba.length;p+=4){rgba[p]=25;rgba[p+1]=24;rgba[p+2]=23;rgba[p+3]=255;}
  entries.forEach((entry,i)=>{
    const x=gap+(i%cols)*(W+gap),y=gap+Math.floor(i/cols)*(H+gap);
    for(let row=0;row<H;row++)rgba.set(entry.rgba.subarray(row*W*4,(row+1)*W*4),((y+row)*width+x)*4);
  });
  return {width,height,rgba,png:encodePngRgba(rgba,width,height)};
}
function emit(path,bytes) {
  const b=Buffer.from(bytes),b64=b.toString('base64'),parts=Math.ceil(b64.length/3000);
  console.log('FW_METRONOME_META '+JSON.stringify({path,size:b.length,sha256:sha256(b),parts}));
  for(let i=0;i<parts;i++)
    console.log('FW_METRONOME_DATA '+JSON.stringify({path,index:i,data:b64.slice(i*3000,(i+1)*3000)}));
}
function build() {
  assert.equal(recipeHash(parent.recipe),PARENT_HASH,'accepted parent identity changed');
  const parentOut=proof(parent.recipe),parentShape=shapeOf(parentOut.rgba);
  const candidates=[];
  for(let i=0;i<COUNT;i++) {
    const bc=bridgeConfig(i),cc=config(i);
    const bridge=mutateRecipe(parent.recipe,bc);
    const child=mutateRecipe(bridge.recipe,cc);
    const output=proof(child.recipe),shape=shapeOf(output.rgba);
    candidates.push({i,bc,cc,bridge,child,output,shape,
      parentXor:xor(parentShape.mask,shape.mask)});
  }
  assert.equal(new Set(candidates.map(c=>c.child.childRecipeHash)).size,COUNT);
  const ranked=[...candidates].sort((a,b)=>{
    const score=s=>s.parentXor*3+s.shape.cells*35+
      Math.min(s.shape.occupied,4000)*0.2+
      Math.min(...s.shape.quadrants)*0.8;
    return score(b)-score(a)||a.i-b.i;
  });
  const finalists=[];
  for(const s of ranked){
    if(s.shape.occupied<80||s.shape.occupied>8000||s.parentXor<80||s.shape.cells<5)continue;
    if(finalists.some(f=>f.output.rawRgbaHash===s.output.rawRgbaHash||
      xor(f.shape.mask,s.shape.mask)<120))continue;
    finalists.push(s);
    if(finalists.length===5)break;
  }
  assert.equal(finalists.length,5,'insufficient morphologically independent canonical finalists');
  for(const s of finalists){
    const early=proof(s.child.recipe,EARLY_TICK);
    s.earlyHash=early.rawRgbaHash;
    s.temporalXor=xor(shapeOf(early.rgba).mask,s.shape.mask);
  }
  // Selected after direct inspection of the genuine six-panel FW-012 CPU sheet.
  // Keep the editorial decision pinned independently from the morphology score.
  const selected=finalists[0];
  assert.equal(selected.i,17,'curated sibling changed; review real pixels before modifying');
  assert.equal(selected.output.rawRgbaHash,'80a5a090d57b6d07','canonical selected pixels changed');
  const sheet=contact([parentOut,...finalists.map(s=>s.output)]);
  assert.deepEqual(decodePngRgba(sheet.png).rgba,sheet.rgba);
  const manifest={
    version:'fw-variant-atlas-v1',
    title:'Unwound Metronome — post-pulse field residue',
    sourceMainCommit:MAIN,
    acceptedParent:{id:PARENT_ID,recipeHash:PARENT_HASH,rawRgbaHash:parentOut.rawRgbaHash},
    mutationVersion:'fw-mutation-v1',
    bridgeMutationSeed:BRIDGE_SEED,childMutationSeed:CHILD_SEED,
    targetTick:TICK,earlyTick:EARLY_TICK,crop:CROP,
    agentCapacity:OPT.agentCapacity,maxDepositions:OPT.maxDepositions,
    candidateCount:COUNT,
    criteria:'Exact canonical RGBA uniqueness, parent silhouette XOR >=80, at least 5 occupied 16px grid cells, >=80 distinct occupied pixels, pairwise finalist silhouette XOR >=120; palette-only duplicates excluded.',
    candidates:candidates.map(s=>({
      siblingIndex:s.i,bridgeConfig:s.bc,config:s.cc,
      bridgeRecipeHash:s.bridge.childRecipeHash,recipeHash:s.child.childRecipeHash,
      rawRgbaHash:s.output.rawRgbaHash,parentSilhouetteXor:s.parentXor,
      occupiedPixels:s.shape.occupied,occupiedCells:s.shape.cells,
      quadrants:s.shape.quadrants,boundingBox:s.shape.bbox,
      mutationOperators:s.child.operations.map(o=>o.type)
    })),
    finalists:finalists.map((s,i)=>({
      panel:i+2,siblingIndex:s.i,recipeHash:s.child.childRecipeHash,
      bridgeRecipeHash:s.bridge.childRecipeHash,childIdentity:s.child.childIdentity,
      rawRgbaHash:s.output.rawRgbaHash,stateHash:s.output.stateHash,
      depositionHash:s.output.depositionHash,resultHash:s.output.resultHash,
      parentSilhouetteXor:s.parentXor,earlyLateSilhouetteXor:s.temporalXor,
      earlyRgbaHash:s.earlyHash,occupiedCells:s.shape.cells,
      occupiedPixels:s.shape.occupied,quadrants:s.shape.quadrants,
      boundingBox:s.shape.bbox
    })),
    contactSheet:{widthPx:sheet.width,heightPx:sheet.height,
      displayOnly:true,rawRgbaHash:rawRgbaHash(sheet.rgba)},
    selection:{siblingIndex:selected.i,method:'direct-inspection-of-actual-canonical-CPU-contact-sheet',rationale:"Actual CPU sheet and full-size #17 inspected: a single folded cyan filament loops downward and rises to the right, with internal parallel striations and an isolated purple vertical misregistration at the left edge. It preserves open dark space above the cup-shaped sweep. The other finalists collapse into left-edge scraps or shorter falling ribbons. Compared with Broken Orbit's extended arc and Faulted Confluence's flatter carrier, this descendant turns into a hollow lower basin rather than a lateral stream. The cropped left registration is intentional but may be too austere for some contexts; no objective aesthetic score is claimed."}
  };
  const files=[
    ['atlas.manifest.json',JSON.stringify(manifest,null,2)+'\n'],
    ['parent.png',parentOut.png],
    ['atlas.png',sheet.png],
    ['selected.png',selected.output.png],
    ['selected.provenance.json',selected.output.provenanceJson],
    ['selected.recipe.json',serializeRecipe(selected.child.recipe)],
    ['selected-bridge.recipe.json',serializeRecipe(selected.bridge.recipe)]
  ];
  finalists.forEach((s,i)=>{
    const n=String(i+1).padStart(2,'0');
    files.push(['candidates/'+n+'.png',s.output.png]);
    files.push(['candidates/'+n+'.recipe.json',serializeRecipe(s.child.recipe)]);
  });
  const reloaded=parseRecipe(serializeRecipe(selected.child.recipe));
  assert.equal(recipeHash(reloaded),selected.child.childRecipeHash);
  assert.equal(readMutationLineage(reloaded).parentRecipeHash,selected.bridge.childRecipeHash);
  assert.equal(readMutationLineage(parseRecipe(serializeRecipe(selected.bridge.recipe))).parentRecipeHash,PARENT_HASH);
  const replay=proof(reloaded),alternate=proof(reloaded,TICK,{tileWidthPx:37,tileHeightPx:29});
  assert.deepEqual(replay.rgba,selected.output.rgba);
  assert.deepEqual(alternate.rgba,selected.output.rgba);
  assert.deepEqual(decodePngRgba(alternate.png).rgba,selected.output.rgba);
  return {files,manifest};
}

test('Unwound Metronome: 18 deterministic double-lineage candidates, five real FW-012 visual finalists',async()=>{
  const {files,manifest}=build();
  let committed=false;
  try{await stat(join(ROOT,'atlas.manifest.json'));committed=true;}
  catch(e){if(e.code!=='ENOENT')throw e;}
  if(!committed){
    console.log('FW_METRONOME_BOOTSTRAP '+JSON.stringify({
      parent:manifest.acceptedParent,finalists:manifest.finalists,
      selection:manifest.selection,candidateCount:manifest.candidateCount}));
    for(const [path,bytes] of files)emit(PREFIX+path,bytes);
  }else{
    for(const [path,bytes] of files){
      assert.deepEqual(await readFile(join(ROOT,path)),Buffer.from(bytes),
        path+' != exact rerendered FW-012 evidence');
    }
    console.log('FW_METRONOME_VERIFIED '+JSON.stringify({
      fileCount:files.length,parent:manifest.acceptedParent,
      selected:manifest.selection,finalists:manifest.finalists.map(f=>[f.siblingIndex,f.rawRgbaHash])}));
  }
});
