import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createCanonicalExport, decodePngRgba, encodePngRgba, rawRgbaHash } from '../../../src/export/index.js';
import { getBuiltinPreset } from '../../../src/presets/index.js';
import { mutateRecipe, readMutationLineage } from '../../../src/mutation/index.js';
import { parseRecipe, recipeHash, serializeRecipe } from '../../../src/recipe/index.js';

// Canonical evolutionary atlas. Never mutate the shipped parent or other galleries.
// First run emits exact files for an audited artifact commit; subsequent runs
// validate the checked-in files byte-for-byte. npm test automatically discovers it.
const HERE = dirname(fileURLToPath(import.meta.url));
const PREFIX = 'gallery/variants/02-broken-orbit/';
const PARENT_ID = 'timeline-pulse';
const EXPECTED_PARENT_HASH = 'c94aed7bfc18a40d';
const MUTATION_SEED = 0x92f4c671;
const TARGET_TICK = 180;
const EARLY_TICK = 16;
const CROP = Object.freeze({ widthPx: 144, heightPx: 112,
  center: { chunkX: 0, chunkY: 0, localX: 100 * 65536, localY: 116 * 65536 },
  unitsPerPixelQ16: 65536 });
const REPLAY = { targetTick: TARGET_TICK, crop: CROP, agentCapacity: 4096,
  maxDepositions: 250000, tileWidthPx: 29, tileHeightPx: 23 };
const BG = [9, 11, 8];
const sha = (b) => createHash('sha256').update(b).digest('hex');

function render(recipe, tick = TARGET_TICK) { return createCanonicalExport(recipe, { ...REPLAY, targetTick: tick }); }
function shape(rgba) {
  const mask = new Uint8Array(rgba.length / 4);
  let occupied = 0, cells = 0;
  for (let p = 0; p < mask.length; p += 1) {
    const i = 4 * p;
    mask[p] = rgba[i] !== BG[0] || rgba[i+1] !== BG[1] || rgba[i+2] !== BG[2] ? 1 : 0;
    occupied += mask[p];
  }
  for (let gy = 0; gy < 7; gy += 1) for (let gx = 0; gx < 9; gx += 1) {
    let found = false;
    for (let y = gy * 16; y < gy * 16 + 16 && !found; y += 1)
      for (let x = gx * 16; x < gx * 16 + 16; x += 1) if (mask[y*144+x]) { found = true; break; }
    if (found) cells += 1;
  }
  return { mask, occupied, cells };
}
function distance(a,b) {
  assert.equal(a.length,b.length);
  let n = 0;
  for (let i=0;i<a.length;i+=1) n += a[i]===b[i] ? 0 : 1;
  return n;
}
function sheet(panels) {
  const margin = 8, width = 3*144+4*margin, height = 2*112+3*margin;
  const rgba = new Uint8Array(width*height*4);
  for(let i=0;i<rgba.length;i+=4) { rgba[i]=23;rgba[i+1]=26;rgba[i+2]=24;rgba[i+3]=255; }
  panels.forEach((p,slot)=>{
    const x0=margin+(slot%3)*(144+margin), y0=margin+Math.floor(slot/3)*(112+margin);
    for(let y=0;y<112;y+=1)
      rgba.set(p.rgba.subarray(y*144*4,(y+1)*144*4),((y0+y)*width+x0)*4);
  });
  return { width, height, rgba, png: encodePngRgba(rgba,width,height) };
}
function file(name,content) { return {path:PREFIX+name, data:Buffer.from(content)}; }
function emit(f) {
  const s=f.data.toString('base64'),count=Math.ceil(s.length/3000);
  console.log('FW_ORBIT_META '+JSON.stringify({path:f.path,count,size:f.data.length,sha256:sha(f.data)}));
  for(let i=0;i<count;i+=1)
    console.log('FW_ORBIT_DATA '+JSON.stringify({path:f.path,index:i,data:s.slice(3000*i,3000*(i+1))}));
}
function make() {
  const parent=getBuiltinPreset(PARENT_ID);
  assert.equal(recipeHash(parent.recipe), EXPECTED_PARENT_HASH);
  const base=render(parent.recipe), baseline=shape(base.rgba);
  const scopes=['all','fields','all','emitters','all','fields','all','seed',
    'all','emitters','all','fields','all','seed','all','fields'];
  const samples=scopes.map((scope,siblingIndex)=>{
    const config={mutationSeed:MUTATION_SEED,siblingIndex,scope,intensity:'bold',
      operationCount:scope==='all'?6:scope==='fields'?2:1};
    const m=mutateRecipe(parent.recipe,config),out=render(m.recipe),sh=shape(out.rgba);
    const early=render(m.recipe,EARLY_TICK),earlyShape=shape(early.rgba);
    return {scope,siblingIndex,config,m,out,mask:sh.mask,occupied:sh.occupied,cells:sh.cells,
      difference:distance(baseline.mask,sh.mask),temporalDifference:distance(earlyShape.mask,sh.mask),
      earlyRawRgbaHash:early.rawRgbaHash,recipeHash:m.childRecipeHash,
      rawRgbaHash:out.rawRgbaHash,identity:m.childIdentity,
      operationTypes:m.operations.map(op=>op.type)};
  });
  assert.equal(new Set(samples.map(s=>s.recipeHash)).size,scopes.length);
  assert.ok(samples.some(s=>s.temporalDifference>=30), 'Timeline comparison must demonstrate actual visible temporal change');
  const ranking=[...samples].sort((a,b)=> (b.difference*8+b.temporalDifference*4+b.cells*16-Math.abs(b.occupied-2100)/8)-
    (a.difference*8+a.temporalDifference*4+a.cells*16-Math.abs(a.occupied-2100)/8) || a.siblingIndex-b.siblingIndex);
  const finalists=[];
  for(const s of ranking) {
    if(s.difference<60 || s.temporalDifference<30 || s.occupied<60 || finalists.some(f=>distance(s.mask,f.mask)<80))continue;
    finalists.push(s);
    if(finalists.length===5)break;
  }
  assert.equal(finalists.length,5,'Five spatially distinct, nonempty variants required; no palette-only substitute');
  // Curated by inspection of the actual six-panel FW-012 software raster atlas:
  // sibling 0 has a cohesive cyan arc and a contrasting green/violet fork.
  const chosen=finalists.find(f=>f.siblingIndex===0);
  assert.ok(chosen, 'Curated sibling must survive the objective diversity gate');
  const roundtrip=parseRecipe(serializeRecipe(chosen.m.recipe));
  assert.equal(recipeHash(roundtrip),chosen.recipeHash);
  assert.equal(readMutationLineage(roundtrip).childIdentity,chosen.identity);
  const reexport=render(roundtrip);
  assert.deepEqual(reexport.rgba,chosen.out.rgba);
  const alt=createCanonicalExport(roundtrip,{...REPLAY,tileWidthPx:47,tileHeightPx:31});
  assert.equal(alt.rawRgbaHash,chosen.out.rawRgbaHash);
  assert.deepEqual(alt.rgba,chosen.out.rgba);
  assert.deepEqual(decodePngRgba(reexport.png).rgba,reexport.rgba);
  const plate=sheet([base,...finalists.map(f=>f.out)]);
  assert.equal(rawRgbaHash(decodePngRgba(plate.png).rgba),rawRgbaHash(plate.rgba));
  const manifest={
    version:'fw-variant-atlas-v1',title:'Broken Orbit — Interrupted Cadence',
    sourceMainCommit:'f4a3909bf9fd2a7ec0c4b073820eddbc6422752b',
    parent:{presetId:PARENT_ID,recipeHash:EXPECTED_PARENT_HASH,rawRgbaHash:base.rawRgbaHash},
    mutationSeed:MUTATION_SEED,targetTick:TARGET_TICK,earlierComparisonTick:EARLY_TICK,crop:CROP,
    agentCapacity:REPLAY.agentCapacity,maxDepositions:REPLAY.maxDepositions,
    candidateCount:samples.length,
    criterion:'Late-tick spatial silhouette XOR from immutable Timeline Pulse parent, temporal change from tick 16 to 180, spatial coverage and pairwise morphology novelty; palette-only differences rejected',
    selectedSiblingIndex:chosen.siblingIndex,selectedRecipeHash:chosen.recipeHash,
    selectedRawRgbaHash:chosen.rawRgbaHash,
    topScoringSiblingIndex:ranking[0].siblingIndex,
    selectionBasis:'Actual FW-012 image inspection favors sibling 0: continuous cyan arc, opposed green/violet fork and deliberate empty centre. Numerical rank 1 was sparser.',
    candidates:samples.map(s=>({siblingIndex:s.siblingIndex,config:s.config,recipeHash:s.recipeHash,
      rawRgbaHash:s.rawRgbaHash,earlyRawRgbaHash:s.earlyRawRgbaHash,temporalShapeChange:s.temporalDifference,occupiedPixels:s.occupied,shapeDifference:s.difference,
      coveredGridCells:s.cells,operationTypes:s.operationTypes})),
    finalists:finalists.map((s,i)=>({panel:i+2,siblingIndex:s.siblingIndex,config:s.config,
      lineageIdentity:s.identity,recipeHash:s.recipeHash,rawRgbaHash:s.rawRgbaHash,
      stateHash:s.out.stateHash,depositionHash:s.out.depositionHash,resultHash:s.out.resultHash,
      occupiedPixels:s.occupied,shapeDifference:s.difference,temporalShapeChange:s.temporalDifference,coveredGridCells:s.cells,
      operationTypes:s.operationTypes})),
    contactSheet:{widthPx:plate.width,heightPx:plate.height,
      panels:'row-major parent then five selected siblings',displayOnly:true,rawRgbaHash:rawRgbaHash(plate.rgba)}
  };
  const readme=[
    '# Broken Orbit — Interrupted Cadence','',
    'A deterministic evolutionary study of the Timeline Pulse preset: the deliberately scheduled freeze, release and burst interventions fracture otherwise continuous motion. This family seeks broken orbits and delayed reconnection, rather than the opposing-current morphology of Countercurrent Canticle.','',
    'Immutable parent: shipped timeline-pulse preset; recipe hash '+EXPECTED_PARENT_HASH+'.',
    'Mutation: fw-mutation-v1; explicit seed '+MUTATION_SEED+'; 16 isolated siblings covering field, emitter, order, seed, material and compound operators.',
    'Canonical comparison: tick '+TARGET_TICK+', with an earlier reference at tick '+EARLY_TICK+'; 144×112 crop centred on (100,116) at one world unit per pixel.',
    'Chosen sibling '+chosen.siblingIndex+'; normalized recipe '+chosen.recipeHash+'; decoded RGBA8 '+chosen.rawRgbaHash+'.','',
    '## Delivered artifacts','',
    '- selected.recipe.json: loadable lineage-bearing child recipe; selected.png: genuine FW-012 canonical CPU render.',
    '- selected.provenance.json: complete versioned canonical export and exact state/pixel identities.',
    '- parent.png and candidates/01–05.png: canonical comparison images at the identical tick and crop.',
    '- atlas.png: presentation-only six-panel contact sheet; assembled pixels are NOT a standalone canonical simulation frame.',
    '- atlas.manifest.json: all 16 explicit mutation configs, early/late hashes, spatial novelty, temporal change and selection records.',
    '- atlas.test.mjs: complete deterministic regeneration, decoded PNG, lineage, import/export, tiled raster and committed-byte checks.','',
    '## Selection logic and limitations','',
    'The real canonical six-panel PNG was inspected. Panel 3 / sibling 0 was deliberately chosen for its long cyan arc and sharp green/violet counterforce; the numerical top scorer sibling 10 appeared less coherent.','',
    'Every candidate is ranked on occupied-pixel silhouette difference from the original, early-to-late silhouette change, spatial spread and occupancy; mechanically near-identical images and palette-only substitutions are rejected. This score is a reproducible search aid, not a claim of aesthetic merit. All legacy artwork and engine source remain untouched.','',
    'Reproduce using npm run verify or node --test gallery/variants/02-broken-orbit/atlas.test.mjs. Offline, software raster only.',''
  ].join('\n');
  const files=[
    file('README.md',readme),
    file('atlas.manifest.json',JSON.stringify(manifest,null,2)+'\n'),
    file('selected.recipe.json',serializeRecipe(chosen.m.recipe)),
    file('selected.png',chosen.out.png),
    file('selected.provenance.json',chosen.out.provenanceJson),
    file('parent.png',base.png),
    file('atlas.png',plate.png)
  ];
  finalists.forEach((s,i)=>{
    const n=String(i+1).padStart(2,'0');
    files.push(file('candidates/'+n+'.recipe.json',serializeRecipe(s.m.recipe)));
    files.push(file('candidates/'+n+'.png',s.out.png));
  });
  return {files,manifest};
}
test('Broken Orbit — immutable timeline parent, temporal morphology, canonical replay and bytes',async()=>{
  const {files,manifest}=make();
  let installed=false;
  try {await stat(join(HERE,'atlas.manifest.json'));installed=true;}
  catch(e){if(e.code!=='ENOENT')throw e;}
  if(!installed) {
    console.log('FW_ORBIT_BOOTSTRAP '+JSON.stringify({candidateCount:manifest.candidateCount,
      selectedSiblingIndex:manifest.selectedSiblingIndex,selectedRecipeHash:manifest.selectedRecipeHash,
      selectedRawRgbaHash:manifest.selectedRawRgbaHash,finalists:manifest.finalists.map(f=>({
        sibling:f.siblingIndex,shapeDifference:f.shapeDifference,temporalChange:f.temporalShapeChange,occupied:f.occupiedPixels,rgba:f.rawRgbaHash}))}));
    files.forEach(emit);
  } else {
    for(const f of files)assert.deepEqual(await readFile(join(HERE,f.path.slice(PREFIX.length))),f.data,
      f.path+' differs from authoritative re-render');
    console.log('FW_ORBIT_VERIFIED '+JSON.stringify({files:files.length,selectedSiblingIndex:manifest.selectedSiblingIndex,
      rawRgbaHash:manifest.selectedRawRgbaHash}));
  }
});
