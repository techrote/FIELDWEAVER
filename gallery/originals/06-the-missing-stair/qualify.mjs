import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseRecipe, serializeRecipe, recipeHash, replayRecipeToTick } from '../../../src/recipe/index.js';
import { createCanonicalExport, decodePngRgba, rawRgbaHash } from '../../../src/export/index.js';

export const ART_ID='06-the-missing-stair',SEED=1278120375,TICK=148;
export async function qualify({write=false}={}){
 const raw=await readFile(new URL('./recipe.json',import.meta.url),'utf8');
 const recipe=parseRecipe(raw);
 assert.equal(serializeRecipe(recipe),raw,'recipe must be normalized');
 assert.equal(recipe.seed,SEED);assert.equal(recipe.lineage,null);
 assert.equal(recipe.fields.layers.length,7);assert.equal(recipe.emitters.length,70);
 assert.equal(recipe.commands.length,17);assert.equal(recipe.lut.assets.length,5);
 const params={targetTick:TICK,crop:recipe.framing,agentCapacity:4096,maxDepositions:280000};
 const a=createCanonicalExport(recipe,{...params,tileWidthPx:37,tileHeightPx:41});
 const b=createCanonicalExport(recipe,{...params,tileWidthPx:63,tileHeightPx:31});
 assert.deepEqual(a.rgba,b.rgba,'tile choice cannot change canonical RGBA pixels');
 for(const k of ['rawRgbaHash','stateHash','depositionHash','resultHash'])assert.equal(a[k],b[k],k);
 const decoded=decodePngRgba(a.png);
 assert.equal(decoded.widthPx,320);assert.equal(decoded.heightPx,240);
 assert.deepEqual(decoded.rgba,a.rgba);assert.equal(rawRgbaHash(decoded.rgba),a.rawRgbaHash);
 const replay=replayRecipeToTick(recipe,TICK,{capacity:4096,maxDepositions:280000});
 assert.equal(replay.resultHash(),a.resultHash);
 const early=replayRecipeToTick(recipe,61,{capacity:4096,maxDepositions:280000});
 const roundtrip=replayRecipeToTick(parseRecipe(serializeRecipe(recipe)),61,{capacity:4096,maxDepositions:280000});
 assert.equal(roundtrip.resultHash(),early.resultHash());
 assert.notEqual(early.resultHash(),replay.resultHash());
 assert(a.depositionCount>500&&a.depositionCount<280000,'visible deposited material required');
 const receipt={artwork:ART_ID,seed:SEED,recipeHash:recipeHash(recipe),targetTick:TICK,crop:recipe.framing,depositionCount:a.depositionCount,rawRgbaHash:a.rawRgbaHash,stateHash:a.stateHash,depositionHash:a.depositionHash,resultHash:a.resultHash};
 if(process.env.CI&&!await fileExists(new URL('./the-missing-stair.png',import.meta.url))){
  console.log('FW06_RECEIPT='+JSON.stringify(receipt));
  console.log('FW06_PNG64='+Buffer.from(a.png).toString('base64'));
  console.log('FW06_PROVENANCE64='+Buffer.from(a.provenanceJson).toString('base64'));
 }
 if(await fileExists(new URL('./qualification.json',import.meta.url))){
  assert.deepEqual(JSON.parse(await readFile(new URL('./qualification.json',import.meta.url),'utf8')),receipt);
  assert.deepEqual(await readFile(new URL('./the-missing-stair.png',import.meta.url)),Buffer.from(a.png));
  assert.equal(await readFile(new URL('./the-missing-stair.provenance.json',import.meta.url),'utf8'),a.provenanceJson);
 }
 if(write){
  await writeFile(new URL('./the-missing-stair.png',import.meta.url),a.png);
  await writeFile(new URL('./the-missing-stair.provenance.json',import.meta.url),a.provenanceJson);
  await writeFile(new URL('./qualification.json',import.meta.url),JSON.stringify(receipt,null,2)+'\n');
 }
 return {receipt,png:a.png,provenanceJson:a.provenanceJson,rgba:a.rgba};
}
async function fileExists(path){try{await readFile(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))qualify({write:process.argv.includes('--write')}).then(({receipt})=>console.log(JSON.stringify(receipt)));
