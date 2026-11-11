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

const HERE = dirname(fileURLToPath(import.meta.url));
const PREFIX = 'gallery/variants/03-offworld-fold/';
const BASE_COMMIT = '817dd4bf4a5dd5a6aba3a4f609e64707d333b1a8';
const PARENT_ID = 'infinite-lineage';
const MUTATION_SEED = 0x79e3a621;
const TICK = 176, EARLY_TICK = 20;
const parent = getBuiltinPreset(PARENT_ID);
const CROP = Object.freeze({
  widthPx: 160, heightPx: 120,
  center: { ...parent.recipe.framing.center },
  unitsPerPixelQ16: 81920
});
const OPTIONS = { crop: CROP, targetTick: TICK, agentCapacity: 4096,
  maxDepositions: 250000, tileWidthPx: 29, tileHeightPx: 23 };
const BGRGB = [9, 11, 8];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exportAt = (recipe, tick = TICK, opts = {}) => createCanonicalExport(recipe, { ...OPTIONS, targetTick: tick, ...opts });
const configFor = (index) => {
  const scope = ['all', 'seed', 'emitters', 'fields'][index % 4];
  return { mutationSeed: MUTATION_SEED, siblingIndex: index, scope,
    intensity: 'bold', operationCount: scope === 'all' ? 6 : scope === 'fields' ? 2 : 1 };
};

function silhouette(rgba) {
  const mask = new Uint8Array(rgba.length / 4);
  let count = 0, cells = 0;
  for (let i = 0; i < mask.length; i++) {
    const p = i * 4;
    mask[i] = +(rgba[p] !== BGRGB[0] || rgba[p+1] !== BGRGB[1] || rgba[p+2] !== BGRGB[2]);
    count += mask[i];
  }
  for (let gy = 0; gy < 6; gy++) for (let gx = 0; gx < 8; gx++) {
    let hit = false;
    for (let y = gy * 20; y < (gy+1)*20 && !hit; y++)
      for (let x = gx * 20; x < (gx+1)*20; x++)
        if (mask[y * 160+x]) { hit = true; break; }
    cells += +hit;
  }
  return { mask, count, cells };
}
function xor(a,b) {
  assert.equal(a.length,b.length);
  let n = 0;
  for (let i=0; i<a.length; i++) n += +(a[i] !== b[i]);
  return n;
}
function sheet(exports) {
  const w=3*160+4*8,h=2*120+3*8, rgba=new Uint8Array(w*h*4);
  for(let i=0;i<rgba.length;i+=4){rgba[i]=22;rgba[i+1]=25;rgba[i+2]=24;rgba[i+3]=255;}
  exports.forEach((out,n)=>{
    const x=8+(n%3)*168,y=8+Math.floor(n/3)*128;
    for(let j=0;j<120;j++)
      rgba.set(out.rgba.subarray(j*160*4,(j+1)*160*4), ((y+j)*w+x)*4);
  });
  return { widthPx:w,heightPx:h,rgba,png:encodePngRgba(rgba,w,h) };
}
function packageFile(path,data) { return { path:PREFIX+path, data:Buffer.from(data) }; }
function emit(file) {
  const base64=file.data.toString('base64');
  const chunks=Math.ceil(base64.length/3200);
  console.log('FW_FOLD_META '+JSON.stringify({path:file.path,chunks,size:file.data.length,sha256:hash(file.data)}));
  for(let i=0;i<chunks;i++)
    console.log('FW_FOLD_DATA '+JSON.stringify({path:file.path,index:i,data:base64.slice(3200*i,3200*(i+1))}));
}
function build() {
  assert.equal(recipeHash(parent.recipe),parent.recipeHash, 'accepted parent hash changed');
  const parentExport=exportAt(parent.recipe), parentShape=silhouette(parentExport.rgba);
  const samples=[];
  for(let i=0;i<24;i++) {
    const config=configFor(i), mutation=mutateRecipe(parent.recipe,config);
    const output=exportAt(mutation.recipe), shape=silhouette(output.rgba);
    samples.push({
      siblingIndex:i,config,mutation,output,mask:shape.mask,
      occupied:shape.count,spread:shape.cells,
      parentXor:xor(parentShape.mask,shape.mask),
      lineage:readMutationLineage(mutation.recipe),
      operationTypes:mutation.operations.map(x=>x.type)
    });
  }
  assert.equal(new Set(samples.map(s=>s.mutation.childRecipeHash)).size,24,'mutation identities collided');
  const ranked=[...samples].sort((a,b)=>
    (b.parentXor*7 + b.spread*22 + b.occupied/4) -
    (a.parentXor*7 + a.spread*22 + a.occupied/4) || a.siblingIndex-b.siblingIndex);
  const finalists=[];
  for(const s of ranked){
    if(s.occupied<35 || s.parentXor<55 || s.spread<3 || finalists.some(f=>xor(s.mask,f.mask)<75))continue;
    finalists.push(s);
    if(finalists.length===5) break;
  }
  assert.equal(finalists.length,5,'five genuinely separated spatial morphologies are required');
  for(const s of finalists){
    const early=exportAt(s.mutation.recipe,EARLY_TICK);
    s.temporalXor=xor(silhouette(early.rgba).mask,s.mask);
    s.earlyHash=early.rawRgbaHash;
  }
  const chart=sheet([parentExport,...finalists.map(f=>f.output)]);
  assert.deepEqual(decodePngRgba(chart.png).rgba,chart.rgba);
  const candidateRecords=samples.map(s=>({
    siblingIndex:s.siblingIndex,config:s.config,
    recipeHash:s.mutation.childRecipeHash,rawRgbaHash:s.output.rawRgbaHash,
    occupiedPixels:s.occupied,coveredCells:s.spread,silhouetteDifference:s.parentXor,
    operationTypes:s.operationTypes
  }));
  const manifest={
    version:'fw-variant-atlas-v1', title:'Offworld Fold — far-plate material discontinuity',
    sourceMainCommit:BASE_COMMIT, parent:{presetId:PARENT_ID,recipeHash:parent.recipeHash,rawRgbaHash:parentExport.rawRgbaHash},
    mutationSeed:MUTATION_SEED, targetTick:TICK,earlyTick:EARLY_TICK,crop:CROP,
    agentCapacity:OPTIONS.agentCapacity,maxDepositions:OPTIONS.maxDepositions,
    candidateCount:samples.length,selectionCriteria:'Occupancy, 20-pixel grid spread, silhouette XOR from accepted parent and pairwise silhouette XOR; no hue-only equivalence qualifies',
    candidates:candidateRecords,
    finalists:finalists.map((s,index)=>({
      panel:index+2,siblingIndex:s.siblingIndex,config:s.config,
      lineageIdentity:s.lineage.childIdentity,recipeHash:s.mutation.childRecipeHash,
      rawRgbaHash:s.output.rawRgbaHash,stateHash:s.output.stateHash,
      depositionHash:s.output.depositionHash,resultHash:s.output.resultHash,
      occupiedPixels:s.occupied,coveredCells:s.spread,
      silhouetteDifference:s.parentXor,temporalSilhouetteDifference:s.temporalXor,
      earlyRawRgbaHash:s.earlyHash,operationTypes:s.operationTypes
    })),
    contactSheet:{widthPx:chart.widthPx,heightPx:chart.heightPx,displayOnly:true,rawRgbaHash:rawRgbaHash(chart.rgba)},
    selection:{siblingIndex:16,artisticRationale:'Actual canonical contact-sheet inspection: sibling 16 breaks the parent’s single sparse hooked line into a taut cyan multi-strand skein, flaring from a saturated left-side knot and fanning through a large dark field. Sibling 20 is colourful but congested at its root; 7/4 closely echo the parent and 8 remains a narrow fork. Selected for coherent structural divergence, not numerical rank alone.'}
  };
  const files=[
    packageFile('atlas.manifest.json',JSON.stringify(manifest,null,2)+'\n'),
    packageFile('parent.png',parentExport.png),
    packageFile('atlas.png',chart.png)
  ];
  for(let i=0;i<finalists.length;i++){
    const s=finalists[i],num=String(i+1).padStart(2,'0');
    files.push(packageFile('candidates/'+num+'.recipe.json',serializeRecipe(s.mutation.recipe)));
    files.push(packageFile('candidates/'+num+'.png',s.output.png));
  }
  const choice=finalists[0];
  assert.equal(choice.siblingIndex,16,'image-reviewed editorial selection must remain a finalist');
  const note=[
    '# Offworld Fold — The Unspooling Relay','',
    'A mutation atlas from the accepted Infinite Lineage far-world preset. A small false-colour knot at the left unspools into multiple bright cyan trails: a horizontal electronic skein balanced by a substantial dark plate. A rare expansive register amid a family of sparsely branched signals.','',
    'The parent is the shipped immutable `infinite-lineage` recipe; no pending original or variant art was used. Parent recipe hash: '+parent.recipeHash+'.',
    'Mutation: `fw-mutation-v1`, seed `0x79e3a621`, 24 explicit siblings, mixed all/seed/emitter/field scopes, bold intensity; sibling 16 selected. Child recipe hash: '+choice.mutation.childRecipeHash+'; canonical RGBA8 hash: '+choice.output.rawRgbaHash+'.',
    'Canonical FW-012 CPU raster: exact tick 176, 160×120 crop, centre (chunk 12, -7; local 128,128), 1.25 world units per pixel. Independent reference tick 20. No WebGL pixels used.','',
    '## Selection','',
    'The actual six-panel canonical contact sheet was inspected. Parent panel 1 is a sparse hooked branch. Selected panel 2 / sibling 16 changes the topology and occupied silhouette: a saturated node releases several long cyan threads with differently bending tangents. The air between trails and the broad dark upper/lower registers are essential, not blank filler. Panel 3 is visually more congested at the knot; panels 4 and 5 are relatively parent-like; panel 6 preserves a more isolated fork. The selection values sustained tension and legible branching, not just the largest score.','',
    'Search and filtering: 24 actual normalized FW-011 mutants, replayed at one crop/tick, compared by decoded FW-012 occupied-pixel silhouettes, parent XOR, 20-pixel spatial spread and pairwise XOR. A shared early tick checks temporal evolution; simple palette changes cannot create a silhouette difference. All 24 identities and explicit configs are retained in `atlas.manifest.json`.','',
    '## Artifacts and replay','',
    '- `selected.recipe.json` — loadable typed recipe with complete lineage.',
    '- `selected.png` and `selected.provenance.json` — exact canonical CPU proof, output hashes and full recipe.',
    '- `parent.png`, five `candidates/NN.recipe.json` plus corresponding canonical PNGs — same-tick comparison.',
    '- `atlas.png` — six-panel display-only contact sheet; not a standalone simulation frame.',
    '- `atlas.test.mjs` — regenerates every committed byte, checks normalization/lineage and tile-order replay.','',
    'Run `npm run verify` on Node 22/24, or `node --test gallery/variants/03-offworld-fold/atlas.test.mjs`. All assets use only repository-local dependencies; no source/engine/editor or prior artwork changed.',''
  ].join('\n');
  files.push(packageFile('README.md',note));
  files.push(packageFile('selected.recipe.json',serializeRecipe(choice.mutation.recipe)));
  files.push(packageFile('selected.png',choice.output.png));
  files.push(packageFile('selected.provenance.json',choice.output.provenanceJson));
  const roundtrip=parseRecipe(serializeRecipe(choice.mutation.recipe));
  assert.equal(recipeHash(roundtrip),choice.mutation.childRecipeHash);
  assert.equal(readMutationLineage(roundtrip).childIdentity,choice.lineage.childIdentity);
  const replay=exportAt(roundtrip,TICK); // fresh independent replay at the explicit shared tick
  assert.equal(replay.rawRgbaHash,choice.output.rawRgbaHash);
  assert.deepEqual(replay.rgba,choice.output.rgba);
  const tiled=exportAt(roundtrip,TICK,{tileWidthPx:37,tileHeightPx:41});
  assert.deepEqual(tiled.rgba,choice.output.rgba);
  assert.deepEqual(decodePngRgba(tiled.png).rgba,tiled.rgba);
  return {files,manifest,finalists};
}

test('Offworld Fold — accepted far-plate parent, bounded atlas, exact canonical RGBA and roundtrip',async()=>{
  const { files,manifest }=build();
  let committed=false;
  try {await stat(join(HERE,'atlas.manifest.json'));committed=true;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(!committed){
    console.log('FW_FOLD_BOOTSTRAP '+JSON.stringify({
      parent:manifest.parent,mutationSeed:manifest.mutationSeed,crop:manifest.crop,
      candidateCount:manifest.candidateCount,finalists:manifest.finalists.map(f=>({
        siblingIndex:f.siblingIndex,pixels:f.occupiedPixels,spread:f.coveredCells,
        parentXor:f.silhouetteDifference,temporalXor:f.temporalSilhouetteDifference,
        raw:f.rawRgbaHash}))}));
    // All artifacts are raw canonical exports/recipes, not browser/GPU previews.
    for(const file of files)emit(file);
  }else{
    for(const file of files)
      assert.deepEqual(await readFile(join(HERE,file.path.slice(PREFIX.length))),file.data,
        file.path+' differs from independent canonical regeneration');
    console.log('FW_FOLD_VERIFIED '+JSON.stringify({files:files.length,rawRgbaHashes:manifest.finalists.map(x=>x.rawRgbaHash)}));
  }
});
