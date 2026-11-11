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

// Exact FW-012 CPU exports only: never WebGL previews or browser screenshots.
const DIR = dirname(fileURLToPath(import.meta.url));
const PREFIX = 'gallery/variants/07-divided-register/';
const PARENT = 'first-weave', PARENT_HASH = 'bb1a24bc2c9cf0bc';
const FIRST_SEED = 0x7b1db29c, SECOND_SEED = 0x52a41c6e;
const COUNT = 20, TICK = 172, EARLY = 42, W = 192, H = 144;
const BKG = [9, 11, 8];
const CROP = Object.freeze({
  widthPx: W, heightPx: H,
  center: { chunkX: 0, chunkY: 0, localX: 142 * 65536, localY: 126 * 65536 },
  unitsPerPixelQ16: 49152
});
const OPT = Object.freeze({
  crop: CROP, targetTick: TICK, agentCapacity: 4096,
  maxDepositions: 250000, tileWidthPx: 31, tileHeightPx: 23
});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const exportAt = (recipe, tick = TICK, extras = {}) =>
  createCanonicalExport(recipe, { ...OPT, targetTick: tick, ...extras });
const bridgeConfig = index => ({
  mutationSeed: FIRST_SEED, siblingIndex: index, scope: 'all',
  intensity: 'bold', operationCount: 6
});
const childConfig = index => {
  const scope = ['fields','all','emitters','seed','parameters','order','all'][index % 7];
  return {
    mutationSeed: SECOND_SEED, siblingIndex: index, scope,
    intensity: 'bold', operationCount: scope === 'all' ? 6 : scope === 'fields' ? 2 : 1
  };
};
function shape(rgba) {
  const mask = new Uint8Array(W * H);
  const cells = new Uint8Array(12 * 9);
  const quadrants = [0, 0, 0, 0];
  let count = 0, minX = W, minY = H, maxX = -1, maxY = -1;
  for(let y = 0; y < H; y++) for(let x = 0; x < W; x++) {
    const j = y * W + x, p = j * 4;
    if(rgba[p] === BKG[0] && rgba[p+1] === BKG[1] && rgba[p+2] === BKG[2]) continue;
    mask[j] = 1;
    count++;
    cells[Math.floor(y / 16) * 12 + Math.floor(x / 16)] = 1;
    quadrants[(y >= H / 2 ? 2 : 0) + (x >= W / 2 ? 1 : 0)]++;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return {
    mask, occupied: count, occupiedCells: cells.reduce((a,b) => a+b, 0),
    quadrants, bbox: count ? {minX,minY,maxX,maxY} : null
  };
}
function xor(a,b) {
  assert.equal(a.length,b.length);
  let n = 0;
  for(let i = 0; i < a.length; i++) if(a[i] !== b[i]) n++;
  return n;
}
function score(c) {
  const q = c.shape.quadrants;
  const seen = q.filter(n => n > 30).length;
  const imbalance = Math.abs((q[0] + q[2]) - (q[1] + q[3]));
  return c.parentXor * 3 + c.shape.occupiedCells * 55 +
    Math.min(c.shape.occupied, 4000) * 0.16 + seen * 90 -
    imbalance * 0.12;
}
function sheet(entries) {
  const pad = 8, columns = 3, rows = 2;
  const width = W * columns + (columns+1)*pad;
  const height = H * rows + (rows+1)*pad;
  const rgba = new Uint8Array(width*height*4);
  for(let i = 0; i < rgba.length; i+=4) {
    rgba[i]=23; rgba[i+1]=23; rgba[i+2]=23; rgba[i+3]=255;
  }
  entries.forEach((item,k) => {
    const x = pad+(k%columns)*(W+pad), y = pad+Math.floor(k/columns)*(H+pad);
    for(let row=0;row<H;row++)
      rgba.set(item.rgba.subarray(row*W*4,(row+1)*W*4),((y+row)*width+x)*4);
  });
  return { width, height, rgba, png: encodePngRgba(rgba,width,height) };
}
function emit(path, contents) {
  const buffer=Buffer.from(contents), base64=buffer.toString('base64'), size=2400;
  console.log('FW_DIVIDED_META '+JSON.stringify({
    path, bytes:buffer.length, sha256:sha(buffer), parts:Math.ceil(base64.length/size)
  }));
  for(let i=0;i<Math.ceil(base64.length/size);i++) {
    console.log('FW_DIVIDED_DATA '+JSON.stringify({
      path, index:i, data:base64.slice(i*size,(i+1)*size)
    }));
  }
}
function produce() {
  const parent = getBuiltinPreset(PARENT);
  assert.equal(recipeHash(parent.recipe), PARENT_HASH, 'immutable accepted preset changed');
  const parentOut = exportAt(parent.recipe);
  const parentShape = shape(parentOut.rgba);
  const all = [];
  for(let i=0;i<COUNT;i++) {
    const bc=bridgeConfig(i), cc=childConfig(i);
    const bridge=mutateRecipe(parent.recipe,bc);
    const child=mutateRecipe(bridge.recipe,cc);
    const output=exportAt(child.recipe);
    const s=shape(output.rgba);
    all.push({i,bc,cc,bridge,child,output,shape:s,
      parentXor:xor(parentShape.mask,s.mask)});
  }
  assert.equal(new Set(all.map(x=>x.child.childRecipeHash)).size,COUNT,
    'candidate recipe hashes must all be different');
  const ranked=[...all].sort((a,b)=>score(b)-score(a)||a.i-b.i);
  const finalists=[];
  for(const item of ranked) {
    if(item.shape.occupied < 85 || item.shape.occupied > 8500 ||
      item.shape.occupiedCells < 5 || item.parentXor < 140) continue;
    if(finalists.some(f => f.output.rawRgbaHash===item.output.rawRgbaHash ||
      xor(f.shape.mask,item.shape.mask) < 140)) continue;
    finalists.push(item);
    if(finalists.length===5) break;
  }
  assert.equal(finalists.length,5,'five nontrivially distinct morphologies required');
  for(const c of finalists) {
    const early=exportAt(c.child.recipe, EARLY);
    c.earlyHash=early.rawRgbaHash;
    c.temporalXor=xor(shape(early.rgba).mask,c.shape.mask);
  }
  // Pinned after direct inspection of real FW-012 CPU output; numerical rank never decides taste.
  const selected=finalists.find(c => c.i === 15);
  assert.ok(selected,'curated sibling 15 missing; re-inspect actual pixels before changing');
  assert.equal(selected.output.rawRgbaHash,'db78ce9e21d39c31','curated canonical pixels changed');
  const atlas=sheet([parentOut,...finalists.map(c=>c.output)]);
  assert.deepEqual(decodePngRgba(atlas.png).rgba,atlas.rgba);
  const manifest={
    version:'fw-variant-atlas-v1', title:'Divided Register — interrupted flow study',
    sourceMainCommit:'90b8f2ebe9ae523745f11006746b0feb1babaaf3',
    acceptedParent:{id:PARENT,recipeHash:PARENT_HASH,rawRgbaHash:parentOut.rawRgbaHash},
    mutationVersion:'fw-mutation-v1', firstMutationSeed:FIRST_SEED,
    secondMutationSeed:SECOND_SEED, targetTick:TICK, earlyTick:EARLY,
    crop:CROP,agentCapacity:OPT.agentCapacity,maxDepositions:OPT.maxDepositions,
    candidateCount:COUNT,
    criteria:'20 two-stage FW-011 descendants; exact RGBA uniqueness, parent mask XOR >= 140, occupied pixels 85..8500, occupied 16px cells >= 5, and pairwise finalist mask XOR >= 140. Colour-only variants do not count.',
    candidates:all.map(c=>({
      siblingIndex:c.i,bridgeConfig:c.bc,config:c.cc,
      bridgeRecipeHash:c.bridge.childRecipeHash,recipeHash:c.child.childRecipeHash,
      rawRgbaHash:c.output.rawRgbaHash,parentSilhouetteXor:c.parentXor,
      occupiedPixels:c.shape.occupied,occupiedCells:c.shape.occupiedCells,
      quadrants:c.shape.quadrants,bbox:c.shape.bbox,score:score(c),
      mutationOperators:c.child.operations.map(o=>o.type)
    })),
    finalists:finalists.map((c,i)=>({
      panel:i+2,siblingIndex:c.i,bridgeRecipeHash:c.bridge.childRecipeHash,
      recipeHash:c.child.childRecipeHash,childIdentity:c.child.childIdentity,
      rawRgbaHash:c.output.rawRgbaHash,
      stateHash:c.output.stateHash,depositionHash:c.output.depositionHash,
      resultHash:c.output.resultHash,parentSilhouetteXor:c.parentXor,
      earlyRgbaHash:c.earlyHash,earlyLateSilhouetteXor:c.temporalXor,
      occupiedPixels:c.shape.occupied,occupiedCells:c.shape.occupiedCells,
      quadrants:c.shape.quadrants,bbox:c.shape.bbox,score:score(c)
    })),
    contactSheet:{widthPx:atlas.width,heightPx:atlas.height,displayOnly:true,
      rawRgbaHash:rawRgbaHash(atlas.rgba)},
    selection:{siblingIndex:selected.i,method:'direct-inspection-of-actual-canonical-CPU-contact-sheet',
      rationale:"Actual FW-012 CPU six-panel sheet and selected PNG inspected: sibling 15 climbs into a sharp upward cyan crescent in the upper-right, with parallel pale inner filaments. A tiny magenta/ochre clipped trace remains at the lower-left margin, separated by a deliberate black gulf. Against the same-tick parent, the support shifts from a single short lower-left diagonal to spatially disjoint marks. Unlike Unwound Metronome's central U, the selected gesture rises along the right edge. The clipped accent and severe sparsity are real aesthetic reservations, not hidden by the diversity score."}
  };
  const files=[
    ['atlas.manifest.json',JSON.stringify(manifest,null,2)+'\n'],
    ['parent.png',parentOut.png],
    ['atlas.png',atlas.png],
    ['selected.png',selected.output.png],
    ['selected.recipe.json',serializeRecipe(selected.child.recipe)],
    ['selected-bridge.recipe.json',serializeRecipe(selected.bridge.recipe)],
    ['selected.provenance.json',selected.output.provenanceJson]
  ];
  finalists.forEach((c,k)=>{
    const name=String(k+1).padStart(2,'0');
    files.push(['candidates/'+name+'.png',c.output.png]);
    files.push(['candidates/'+name+'.recipe.json',serializeRecipe(c.child.recipe)]);
  });
  const parsed=parseRecipe(serializeRecipe(selected.child.recipe));
  assert.equal(recipeHash(parsed),selected.child.childRecipeHash);
  assert.equal(readMutationLineage(parsed).parentRecipeHash,selected.bridge.childRecipeHash);
  assert.equal(readMutationLineage(parseRecipe(serializeRecipe(selected.bridge.recipe))).parentRecipeHash,PARENT_HASH);
  const a=exportAt(parsed), b=exportAt(parsed,TICK,{tileWidthPx:37,tileHeightPx:29});
  assert.deepEqual(a.rgba,selected.output.rgba);
  assert.deepEqual(b.rgba,selected.output.rgba);
  assert.deepEqual(decodePngRgba(b.png).rgba,selected.output.rgba);
  return {files,manifest};
}
test('Divided Register: independent two-stage FW-011 family with exact FW-012 evidence',async()=>{
  const {files,manifest}=produce();
  let committed=false;
  try{await stat(join(DIR,'atlas.manifest.json'));committed=true;}
  catch(e){if(e.code!=='ENOENT')throw e;}
  if(!committed) {
    console.log('FW_DIVIDED_BOOTSTRAP '+JSON.stringify({
      parent:manifest.acceptedParent,finalists:manifest.finalists,
      selection:manifest.selection,candidateCount:COUNT
    }));
    for(const [name,bytes] of files) emit(PREFIX+name,bytes);
  } else {
    for(const [name,bytes] of files) {
      assert.deepEqual(await readFile(join(DIR,name)),Buffer.from(bytes),
        'committed canonical evidence differs from recomputed proof: '+name);
    }
    console.log('FW_DIVIDED_VERIFIED '+JSON.stringify({
      candidateCount:COUNT,fileCount:files.length,
      selected:manifest.selection,finalists:manifest.finalists.map(f=>[f.siblingIndex,f.rawRgbaHash])
    }));
  }
});
