// Artwork-owned FW-012 verification; no core or editor changes.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRecipe, serializeRecipe, recipeHash, replayRecipeToTick } from '../../../src/recipe/index.js';
import { createCanonicalExport, decodePngRgba, rawRgbaHash } from '../../../src/export/index.js';
export const ART_ID='04-pollen-observatory';
export const SEED=0x6cf49b12;
export const TARGET_TICK=176;
export const CAPACITY=4096;
export const MAX_DEPOSITIONS=250000;
export async function qualify({write=false}={}){
 const text=await readFile(new URL('./recipe.json',import.meta.url),'utf8');
 const recipe=parseRecipe(text);
 assert.equal(serializeRecipe(recipe),text,'recipe must remain canonical normalized JSON');
 assert.equal(recipe.seed,SEED);assert.equal(recipe.lineage,null);
 assert.equal(recipe.fields.layers.length,9);
 assert.equal(recipe.emitters.length,45);
 assert.equal(recipe.commands.length,23);
 assert.equal(recipe.lut.assets.length,5);
 const args={targetTick:TARGET_TICK,crop:recipe.framing,agentCapacity:CAPACITY,maxDepositions:MAX_DEPOSITIONS};
 const a=createCanonicalExport(recipe,{...args,tileWidthPx:59,tileHeightPx:47});
 const b=createCanonicalExport(recipe,{...args,tileWidthPx:113,tileHeightPx:71});
 assert.deepEqual(a.rgba,b.rgba,'tiling changed RGBA8');
 for(const key of ['rawRgbaHash','stateHash','depositionHash','resultHash'])assert.equal(a[key],b[key],key);
 const decoded=decodePngRgba(a.png);
 assert.equal(decoded.widthPx,576);assert.equal(decoded.heightPx,384);
 assert.deepEqual(decoded.rgba,a.rgba);
 assert.equal(rawRgbaHash(decoded.rgba),a.rawRgbaHash);
 const replay=replayRecipeToTick(recipe,TARGET_TICK,{capacity:CAPACITY,maxDepositions:MAX_DEPOSITIONS});
 assert.equal(replay.resultHash(),a.resultHash);
 assert.equal(replay.depositionHash(),a.depositionHash);
 const mid=replayRecipeToTick(recipe,79,{capacity:CAPACITY,maxDepositions:MAX_DEPOSITIONS});
 const roundtrip=replayRecipeToTick(parseRecipe(serializeRecipe(recipe)),79,{capacity:CAPACITY,maxDepositions:MAX_DEPOSITIONS});
 assert.equal(mid.resultHash(),roundtrip.resultHash());
 assert.notEqual(mid.resultHash(),a.resultHash,'timeline did not evolve');
 assert(a.depositionCount>1000&&a.depositionCount<MAX_DEPOSITIONS);
 const receipt={artwork:ART_ID,seed:SEED,recipeHash:recipeHash(recipe),targetTick:TARGET_TICK,crop:recipe.framing,
  depositionCount:a.depositionCount,rawRgbaHash:a.rawRgbaHash,stateHash:a.stateHash,
  depositionHash:a.depositionHash,resultHash:a.resultHash};
 const expected={
  recipeHash:'5cdf27d4b0c2e205',rawRgbaHash:'194610dd7ca77ca1',
  stateHash:'a44142e5fcb73df5',depositionHash:'62e03786c103dee8',
  resultHash:'4e7ef6ed0d5a6bcd',depositionCount:185004
 };
 for(const [key,value] of Object.entries(expected))assert.equal(receipt[key],value,'golden '+key);
 assert.deepEqual(await readFile(new URL('./pollen-observatory.png',import.meta.url)),Buffer.from(a.png),
  'archived canonical PNG is not byte-identical to fresh FW-012 output');
 assert.equal(await readFile(new URL('./pollen-observatory.provenance.json',import.meta.url),'utf8'),
  a.provenanceJson,'archived provenance differs from fresh FW-012 sidecar');
 assert.deepEqual(JSON.parse(await readFile(new URL('./qualification.json',import.meta.url),'utf8')),receipt,
  'qualification receipt differs from fresh FW-012 replay');
 if(write){
  await mkdir(new URL('./rendered/',import.meta.url),{recursive:true});
  await writeFile(new URL('./rendered/pollen-observatory.png',import.meta.url),a.png);
  await writeFile(new URL('./rendered/pollen-observatory.provenance.json',import.meta.url),a.provenanceJson);
  await writeFile(new URL('./rendered/qualification.json',import.meta.url),JSON.stringify(receipt,null,2)+'\n');
 }
 return {receipt,png:a.png,provenanceJson:a.provenanceJson};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {receipt}=await qualify({write:process.argv.includes('--write')});
 console.log(JSON.stringify(receipt));
}
