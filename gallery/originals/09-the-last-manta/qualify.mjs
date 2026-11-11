// Independent canonical export, roundtrip and tile equivalence qualification.
// --write regenerates the FOUR archives locally; --emit transports actual bytes
// from the authoritative CI Node execution, never a substitute raster.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseRecipe,serializeRecipe,recipeHash,replayRecipeToTick} from '../../../src/recipe/index.js';
import {createCanonicalExport,decodePngRgba,rawRgbaHash} from '../../../src/export/index.js';
import {ART_ID,TARGET_TICK,INTERMEDIATE_TICK,SEED,CROP,createLastManta,authoredRecipeText} from './author.mjs';

const files={recipe:'recipe.json',png:'the-last-manta.png',
  provenance:'the-last-manta.provenance.json',receipt:'qualification.json'};
export function isArchived(){
  return Object.values(files).every(p=>existsSync(new URL('./'+p,import.meta.url)));
}
export async function qualify({archived=false,write=false}={}){
  const recipe=createLastManta(),json=authoredRecipeText();
  assert.equal(json,serializeRecipe(parseRecipe(json)));
  assert.equal(recipe.seed,SEED);
  assert.equal(recipe.lineage,null);
  assert.equal(recipe.fields.layers.length,7);
  assert.equal(recipe.materials.length,4);
  assert.equal(recipe.lut.assets.length,5);
  assert.equal(recipe.lut.mappings.length,5);
  assert.equal(recipe.commands.length,15);
  assert(recipe.emitters.length>220&&recipe.emitters.length<=300);
  const opts={targetTick:TARGET_TICK,crop:CROP,agentCapacity:4096,maxDepositions:250000};
  const a=createCanonicalExport(recipe,{...opts,tileWidthPx:47,tileHeightPx:31});
  const b=createCanonicalExport(parseRecipe(json),{...opts,tileWidthPx:89,tileHeightPx:57});
  assert.deepEqual(a.rgba,b.rgba,'Tile shape or import changed canonical RGBA');
  for(const key of ['rawRgbaHash','stateHash','depositionHash','resultHash'])
    assert.equal(a[key],b[key],'Canonical identity changed: '+key);
  const decoded=decodePngRgba(a.png);
  assert.equal(decoded.widthPx,CROP.widthPx);
  assert.equal(decoded.heightPx,CROP.heightPx);
  assert.deepEqual(decoded.rgba,a.rgba);
  assert.equal(rawRgbaHash(decoded.rgba),a.rawRgbaHash);
  const early=replayRecipeToTick(recipe,INTERMEDIATE_TICK,{capacity:4096,maxDepositions:250000});
  const earlyReimport=replayRecipeToTick(parseRecipe(json),INTERMEDIATE_TICK,
    {capacity:4096,maxDepositions:250000});
  assert.equal(early.resultHash(),earlyReimport.resultHash(),'Intermediate replay mismatch');
  assert.notEqual(early.resultHash(),a.resultHash,'No temporal development');
  let occupied=0;
  for(let i=0;i<a.rgba.length;i+=4)
    if(a.rgba[i]!==9||a.rgba[i+1]!==11||a.rgba[i+2]!==8)occupied++;
  assert(occupied>1800,'Artwork raster has insufficient occupied pixels');
  assert(a.depositionCount>6000&&a.depositionCount<250000,'Unexpected deposition count');
  const receipt={artwork:ART_ID,seed:SEED,recipeHash:recipeHash(recipe),
    targetTick:TARGET_TICK,intermediateTick:INTERMEDIATE_TICK,crop:CROP,
    emitters:recipe.emitters.length,occupiedPixels:occupied,
    depositionCount:a.depositionCount,rawRgbaHash:a.rawRgbaHash,
    stateHash:a.stateHash,depositionHash:a.depositionHash,resultHash:a.resultHash};
  const payload={
    recipe:Buffer.from(json),png:Buffer.from(a.png),
    provenance:Buffer.from(a.provenanceJson),
    receipt:Buffer.from(JSON.stringify(receipt,null,2)+'\n')
  };
  if(archived){
    for(const [kind,bytes] of Object.entries(payload))
      assert.deepEqual(await readFile(new URL('./'+files[kind],import.meta.url)),bytes,
        'Committed '+files[kind]+' differs from canonical regeneration');
  }
  if(write)for(const [kind,bytes] of Object.entries(payload))
    await writeFile(new URL('./'+files[kind],import.meta.url),bytes);
  return {receipt,payload};
}
export function emitArchive(payload){
  for(const [kind,bytes] of Object.entries(payload)){
    const b64=bytes.toString('base64'),size=1800,count=Math.ceil(b64.length/size);
    for(let i=0;i<count;i++)
      console.log('FW9ARCHIVE '+kind+' '+i+'/'+count+' '+b64.slice(i*size,(i+1)*size));
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await qualify({
    archived:process.argv.includes('--archived'),
    write:process.argv.includes('--write')
  });
  console.log('FW9RECEIPT '+JSON.stringify(result.receipt));
  if(process.argv.includes('--emit'))emitArchive(result.payload);
}
