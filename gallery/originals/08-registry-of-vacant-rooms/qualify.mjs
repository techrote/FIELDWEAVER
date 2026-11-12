import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseRecipe,serializeRecipe,recipeHash,replayRecipeToTick} from '../../../src/recipe/index.js';
import {createCanonicalExport,decodePngRgba,rawRgbaHash} from '../../../src/export/index.js';
import {ART_ID,TARGET_TICK,SEED,createVacantRooms,authoredRecipeText} from './author.mjs';
const names={recipe:'recipe.json',png:'the-vacant-rooms.png',
  provenance:'the-vacant-rooms.provenance.json',receipt:'qualification.json'};
export function isArchived(){return Object.values(names).every(n=>existsSync(new URL('./'+n,import.meta.url)));}
export async function qualify({archived=false,write=false}={}){
  const recipe=createVacantRooms(),text=authoredRecipeText();
  assert.equal(serializeRecipe(parseRecipe(text)),text);
  assert.equal(recipe.seed,SEED);
  assert.equal(recipe.lineage,null);
  assert.equal(recipe.fields.layers.length,7);
  assert.equal(recipe.materials.length,4);
  assert.equal(recipe.lut.assets.length,5);
  assert.equal(recipe.lut.mappings.length,5);
  assert.equal(recipe.commands.length,16);
  assert(recipe.emitters.length>110&&recipe.emitters.length<240);
  const opts={targetTick:TARGET_TICK,crop:recipe.framing,
    agentCapacity:4096,maxDepositions:250000};
  const a=createCanonicalExport(recipe,{...opts,tileWidthPx:43,tileHeightPx:37});
  const b=createCanonicalExport(parseRecipe(text),{...opts,tileWidthPx:67,tileHeightPx:53});
  assert.deepEqual(a.rgba,b.rgba,'tile geometry changed RGBA');
  for(const k of ['rawRgbaHash','stateHash','depositionHash','resultHash'])
    assert.equal(a[k],b[k],k+' changed with tile/roundtrip');
  const decoded=decodePngRgba(a.png);
  assert.equal(decoded.widthPx,432);
  assert.equal(decoded.heightPx,304);
  assert.deepEqual(decoded.rgba,a.rgba);
  assert.equal(rawRgbaHash(decoded.rgba),a.rawRgbaHash);
  const early=replayRecipeToTick(recipe,66,{capacity:4096,maxDepositions:250000});
  const round=replayRecipeToTick(parseRecipe(text),66,{capacity:4096,maxDepositions:250000});
  assert.equal(early.resultHash(),round.resultHash());
  assert.notEqual(early.resultHash(),a.resultHash,'score did not evolve');
  let occupied=0;
  for(let i=0;i<a.rgba.length;i+=4)
    if(a.rgba[i]!==9||a.rgba[i+1]!==11||a.rgba[i+2]!==8)occupied++;
  assert(occupied>1500,'inadequate occupied pixel count');
  assert(a.depositionCount>2000&&a.depositionCount<250000);
  const receipt={
    artwork:ART_ID,seed:SEED,recipeHash:recipeHash(recipe),
    targetTick:TARGET_TICK,crop:recipe.framing,emitters:recipe.emitters.length,
    occupiedPixels:occupied,depositionCount:a.depositionCount,
    rawRgbaHash:a.rawRgbaHash,stateHash:a.stateHash,
    depositionHash:a.depositionHash,resultHash:a.resultHash
  };
  const payload={
    recipe:Buffer.from(text),
    png:Buffer.from(a.png),
    provenance:Buffer.from(a.provenanceJson),
    receipt:Buffer.from(JSON.stringify(receipt,null,2)+'\n')
  };
  if(archived){
    for(const [kind,data] of Object.entries(payload))
      assert.deepEqual(await readFile(new URL('./'+names[kind],import.meta.url)),data,
        'Archived '+kind+' differs from FW-012 CPU regeneration');
  }
  if(write)for(const [kind,data] of Object.entries(payload))
    await writeFile(new URL('./'+names[kind],import.meta.url),data);
  return {receipt,payload};
}
// Bounded, lossless CI stdout transport for the first actual software-raster
// run. These lines are evidence, not a fabricated image or a WebGL capture.
export function emitArchive(payload){
  for(const [kind,data] of Object.entries(payload)){
    const b64=data.toString('base64'),chunkSize=2400,total=Math.ceil(b64.length/chunkSize);
    for(let i=0;i<total;i++)
      console.log('FW8ARCHIVE '+kind+' '+i+'/'+total+' '+b64.slice(i*chunkSize,(i+1)*chunkSize));
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {receipt,payload}=await qualify({
    write:process.argv.includes('--write'),
    archived:process.argv.includes('--archived')
  });
  console.log('FW8RECEIPT '+JSON.stringify(receipt));
  if(process.argv.includes('--emit'))emitArchive(payload);
}
