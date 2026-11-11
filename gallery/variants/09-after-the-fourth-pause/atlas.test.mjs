import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { getBuiltinPreset } from '../../../src/presets/index.js';
import { createCanonicalExport, decodePngRgba } from '../../../src/export/index.js';
import { parseRecipe, recipeHash, serializeRecipe } from '../../../src/recipe/index.js';
import { buildAtlas, TICK, CROP, PARENT_ID } from './build.mjs';

const root=dirname(fileURLToPath(import.meta.url));

test('variant 09: exact provenance, nontrivial separated geometry, immutable parent and CPU raster archive',async()=>{
  const baseline=getBuiltinPreset(PARENT_ID);
  const before=serializeRecipe(baseline.recipe);
  const built=buildAtlas();
  assert.equal(built.candidates.length,16);
  assert.equal(new Set(built.candidates.map(c=>c.export.rawRgbaHash)).size,16);
  assert.equal(built.finalists.length,4);
  assert(built.finalists.every(c=>c.parentXor>=140 && c.ink>=90));
  for(let i=0;i<built.finalists.length;i++) for(let j=i+1;j<built.finalists.length;j++){
    let difference=0;
    const a=built.finalists[i].mask,b=built.finalists[j].mask;
    for(let p=0;p<a.length;p++) difference+=a[p]!==b[p];
    assert(difference>=140,'shape distinctness not palette alone');
  }
  assert.equal(serializeRecipe(baseline.recipe),before);
  const child=parseRecipe(built.files.find(f=>f.path==='selected.recipe.json').bytes.toString('utf8'));
  assert.equal(recipeHash(child),built.archive.selection.recipeHash);
  assert.equal(child.lineage.parentRecipeHash,built.selected.first.childRecipeHash);
  const alt=createCanonicalExport(child,{targetTick:TICK,crop:CROP,agentCapacity:4096,maxDepositions:250000,tileWidthPx:29,tileHeightPx:19});
  assert.equal(alt.rawRgbaHash,built.selected.export.rawRgbaHash);
  assert.deepEqual(alt.rgba,built.selected.export.rgba);
  assert.equal(alt.stateHash,built.selected.export.stateHash);
  assert.equal(alt.depositionHash,built.selected.export.depositionHash);
  assert.equal(alt.resultHash,built.selected.export.resultHash);
  const decoded=decodePngRgba(built.selected.export.png);
  assert.equal(decoded.widthPx,CROP.widthPx);
  assert.equal(decoded.heightPx,CROP.heightPx);
  assert.deepEqual(decoded.rgba,built.selected.export.rgba);
  let missing=0;
  for(const file of built.files){
    let archived;
    try{archived=await readFile(join(root,file.path));}catch(error){
      if(error.code!=='ENOENT')throw error;
      missing++;
      console.log('FW_ATLAS_FILE::'+file.path+'::'+file.bytes.toString('base64'));
      continue;
    }
    assert.deepEqual(archived,file.bytes,'archive drift: '+file.path);
  }
  console.log('FW_ATLAS_REPORT '+JSON.stringify({
    parentRecipeHash:built.archive.parent.recipeHash,
    selectedIndex:built.selected.i,selectedRecipeHash:built.archive.selection.recipeHash,
    selectedRgbaHash:built.selected.export.rawRgbaHash,
    candidateCount:built.candidates.length,finalists:built.finalists.map(c=>({index:c.i,rgba:c.export.rawRgbaHash,
      pixels:c.ink,cells:c.cells,xor:c.parentXor,score:c.score,bbox:c.bbox})),
    rawContactSheetHash:built.sheet.rawRgbaHash,missingArchiveFiles:missing
  }));
  assert.equal(missing,0,'Commit the exact FW-012 generated evidence bytes logged above before admission');
});
