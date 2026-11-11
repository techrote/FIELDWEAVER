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
const PREFIX = 'gallery/variants/01-countercurrent-canticle/';
const PARENT_ID = 'operator-atlas';
const EXPECTED_PARENT_HASH = 'ab6f4e5af5842f3a';
const MUTATION_SEED = 0x6d51a7c2;
const TARGET_TICK = 58;
const CROP = Object.freeze({ widthPx: 144, heightPx: 112,
  center: { chunkX: 0, chunkY: 0, localX: 128 * 65536, localY: 128 * 65536 },
  unitsPerPixelQ16: 2 * 65536 });
const REPLAY = { targetTick: TARGET_TICK, crop: CROP, agentCapacity: 4096,
  maxDepositions: 250000, tileWidthPx: 29, tileHeightPx: 23 };
const BG = [9, 11, 8];
const sha = (b) => createHash('sha256').update(b).digest('hex');

function render(recipe) { return createCanonicalExport(recipe, REPLAY); }
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
  console.log('FW_ATLAS_META '+JSON.stringify({path:f.path,count,size:f.data.length,sha256:sha(f.data)}));
  for(let i=0;i<count;i+=1)
    console.log('FW_ATLAS_DATA '+JSON.stringify({path:f.path,index:i,data:s.slice(3000*i,3000*(i+1))}));
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
    return {scope,siblingIndex,config,m,out,mask:sh.mask,occupied:sh.occupied,cells:sh.cells,
      difference:distance(baseline.mask,sh.mask),recipeHash:m.childRecipeHash,
      rawRgbaHash:out.rawRgbaHash,identity:m.childIdentity,
      operationTypes:m.operations.map(op=>op.type)};
  });
  assert.equal(new Set(samples.map(s=>s.recipeHash)).size,scopes.length);
  const ranking=[...samples].sort((a,b)=> (b.difference*10+b.cells*16-Math.abs(b.occupied-2300)/8)-
    (a.difference*10+a.cells*16-Math.abs(a.occupied-2300)/8) || a.siblingIndex-b.siblingIndex);
  const finalists=[];
  for(const s of ranking) {
    if(s.difference<60 || s.occupied<60 || finalists.some(f=>distance(s.mask,f.mask)<80))continue;
    finalists.push(s);
    if(finalists.length===5)break;
  }
  assert.equal(finalists.length,5,'Five spatially distinct, nonempty variants required; no palette-only substitute');
  const chosen=finalists[0], roundtrip=parseRecipe(serializeRecipe(chosen.m.recipe));
  assert.equal(recipeHash(roundtrip),chosen.recipeHash);
  assert.equal(readMutationLineage(roundtrip).childIdentity,chosen.identity);
  const reexport=render(roundtrip);
  assert.deepEqual(reexport.rgba,chosen.out.rgba);
  assert.deepEqual(decodePngRgba(reexport.png).rgba,reexport.rgba);
  const plate=sheet([base,...finalists.map(f=>f.out)]);
  assert.equal(rawRgbaHash(decodePngRgba(plate.png).rgba),rawRgbaHash(plate.rgba));
  const manifest={
    version:'fw-variant-atlas-v1',title:'Countercurrent Canticle',
    sourceMainCommit:'29cbff7da474f5c40192c14599e18b525362dd5b',
    parent:{presetId:PARENT_ID,recipeHash:EXPECTED_PARENT_HASH,rawRgbaHash:base.rawRgbaHash},
    mutationSeed:MUTATION_SEED,targetTick:TARGET_TICK,crop:CROP,
    agentCapacity:REPLAY.agentCapacity,maxDepositions:REPLAY.maxDepositions,
    candidateCount:samples.length,
    criterion:'Silhouette occupancy XOR from parent, spatial coverage, and pairwise silhouette novelty; palette-only differences rejected',
    selectedSiblingIndex:chosen.siblingIndex,selectedRecipeHash:chosen.recipeHash,
    selectedRawRgbaHash:chosen.rawRgbaHash,
    candidates:samples.map(s=>({siblingIndex:s.siblingIndex,config:s.config,recipeHash:s.recipeHash,
      rawRgbaHash:s.rawRgbaHash,occupiedPixels:s.occupied,shapeDifference:s.difference,
      coveredGridCells:s.cells,operationTypes:s.operationTypes})),
    finalists:finalists.map((s,i)=>({panel:i+2,siblingIndex:s.siblingIndex,config:s.config,
      lineageIdentity:s.identity,recipeHash:s.recipeHash,rawRgbaHash:s.rawRgbaHash,
      stateHash:s.out.stateHash,depositionHash:s.out.depositionHash,resultHash:s.out.resultHash,
      occupiedPixels:s.occupied,shapeDifference:s.difference,coveredGridCells:s.cells,
      operationTypes:s.operationTypes})),
    contactSheet:{widthPx:plate.width,heightPx:plate.height,
      panels:'row-major parent then five selected siblings',displayOnly:true,rawRgbaHash:rawRgbaHash(plate.rgba)}
  };
  const readme=[
    '# Countercurrent Canticle — a FIELDWEAVER evolutionary atlas','',
    'An authored study of opposing currents in a four-material simulation: topology, trajectories and layered sedimentation rather than colour-only mutation.','',
    '**Immutable parent:** shipped operator-atlas preset; recipe hash '+EXPECTED_PARENT_HASH+'.',
    '**Mutation:** fw-mutation-v1, seed '+MUTATION_SEED+', 16 explicit siblings with validated bold scope-specific and mixed transformations.',
    '**Canonical evaluation:** tick '+TARGET_TICK+', crop 144×112 centered at (128,128) with 2 world units/pixel, agent cap 4096, deposition cap 250000.',
    '**Selected descendant:** sibling '+chosen.siblingIndex+', recipe '+chosen.recipeHash+', decoded RGBA hash '+chosen.rawRgbaHash+'.','',
    '## Files','',
    '- selected.recipe.json: loadable full child recipe with fw-lineage-v1 ancestry; selected.png: authoritative FW-012 software raster.',
    '- selected.provenance.json: complete canonical export sidecar, including saved recipe, crop/tick and canonical state/pixel identities.',
    '- parent.png: untouched parent rendered with the same crop/tick.',
    '- candidates/01–05.recipe.json and matching PNGs: independent, directly loadable distinct finalists.',
    '- atlas.png: presentation contact sheet, six panels row-major (parent, then finalists); the assembled contact sheet is NOT a canonical simulation output.',
    '- atlas.manifest.json: all sixteen exact seeds/lineages/differences and finalist identities.',
    '- atlas.test.mjs: deterministic standalone regeneration and committed-byte verification, discovered by npm test.','',
    '## Selection and limitations','',
    'The mechanical qualification measures changed binary pixel occupancy and spatial spread and rejects near-duplicate shapes; recolouring alone cannot win. The contact sheet permits independent visual judgment; numerical novelty is not a claim of superior aesthetics. All source art and code in main remain unchanged.',
    '',
    'Run npm run verify or node --test gallery/variants/01-countercurrent-canticle/atlas.test.mjs from the root. No network, GPU or external packages required.',''
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
test('Countercurrent Canticle — immutable parent, independent morphology, canonical replay and bytes',async()=>{
  const {files,manifest}=make();
  let installed=false;
  try {await stat(join(HERE,'atlas.manifest.json'));installed=true;}
  catch(e){if(e.code!=='ENOENT')throw e;}
  if(!installed) {
    console.log('FW_ATLAS_BOOTSTRAP '+JSON.stringify({candidateCount:manifest.candidateCount,
      selectedSiblingIndex:manifest.selectedSiblingIndex,selectedRecipeHash:manifest.selectedRecipeHash,
      selectedRawRgbaHash:manifest.selectedRawRgbaHash,finalists:manifest.finalists.map(f=>({
        sibling:f.siblingIndex,shapeDifference:f.shapeDifference,occupied:f.occupiedPixels,rgba:f.rawRgbaHash}))}));
    files.forEach(emit);
  } else {
    for(const f of files)assert.deepEqual(await readFile(join(HERE,f.path.slice(PREFIX.length))),f.data,
      f.path+' differs from authoritative re-render');
    console.log('FW_ATLAS_VERIFIED '+JSON.stringify({files:files.length,selectedSiblingIndex:manifest.selectedSiblingIndex,
      rawRgbaHash:manifest.selectedRawRgbaHash}));
  }
});
