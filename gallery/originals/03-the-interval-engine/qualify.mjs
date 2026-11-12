// Original artwork-only verifier; no changes to simulation/export source.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRecipe, serializeRecipe, recipeHash, replayRecipeToTick } from '../../../src/recipe/index.js';
import { createCanonicalExport, decodePngRgba, rawRgbaHash } from '../../../src/export/index.js';
export const ART_ID = '03-the-interval-engine';
export const SEED = 0x59a11e73;
export const TARGET_TICK = 176;
export const CAPACITY = 4096;
export const MAX_DEPOSITIONS = 250000;
export const EXPECTED_RECIPE_HASH = '4adb2abba8c7999f';
export const EXPECTED_RAW_RGBA_HASH = 'fd389a9bb0ce640f';
export const EXPECTED_RESULT_HASH = '468a91bf82bbb51d';
export async function qualify({write=false}={}) {
 const text=await readFile(new URL('./recipe.json',import.meta.url),'utf8');
 const recipe=parseRecipe(text);
 assert.equal(serializeRecipe(recipe),text,'Recipe must be canonical normalized JSON');
 assert.equal(recipe.seed,SEED);assert.equal(recipe.lineage,null);
 assert.equal(recipe.fields.layers.length,6);assert.equal(recipe.emitters.length,40);
 assert.equal(recipe.commands.length,15);assert.equal(recipe.lut.assets.length,5);
 const args={targetTick:TARGET_TICK,crop:recipe.framing,agentCapacity:CAPACITY,maxDepositions:MAX_DEPOSITIONS};
 const a=createCanonicalExport(recipe,{...args,tileWidthPx:53,tileHeightPx:41});
 const b=createCanonicalExport(recipe,{...args,tileWidthPx:97,tileHeightPx:59});
 assert.deepEqual(a.rgba,b.rgba,'Tile partition changed canonical pixels');
 for(const key of ['rawRgbaHash','stateHash','depositionHash','resultHash'])assert.equal(a[key],b[key],key);
 const decoded=decodePngRgba(a.png);
 assert.equal(decoded.widthPx,512);assert.equal(decoded.heightPx,384);
 assert.deepEqual(decoded.rgba,a.rgba,'PNG did not preserve exact canonical RGBA8');
 assert.equal(rawRgbaHash(decoded.rgba),a.rawRgbaHash);
 const fresh=replayRecipeToTick(recipe,TARGET_TICK,{capacity:CAPACITY,maxDepositions:MAX_DEPOSITIONS});
 assert.equal(fresh.resultHash(),a.resultHash);assert.equal(fresh.depositionHash(),a.depositionHash);
 const half=replayRecipeToTick(recipe,83,{capacity:CAPACITY,maxDepositions:MAX_DEPOSITIONS});
 const roundtrip=replayRecipeToTick(parseRecipe(serializeRecipe(recipe)),83,{capacity:CAPACITY,maxDepositions:MAX_DEPOSITIONS});
 assert.equal(half.resultHash(),roundtrip.resultHash(),'midpoint roundtrip changed replay');
 assert.notEqual(half.resultHash(),a.resultHash,'Interventions did not advance the artwork');
 assert(a.depositionCount>1000&&a.depositionCount<MAX_DEPOSITIONS);
 const receipt={artwork:ART_ID,seed:SEED,recipeHash:recipeHash(recipe),targetTick:TARGET_TICK,crop:recipe.framing,
  depositionCount:a.depositionCount,rawRgbaHash:a.rawRgbaHash,stateHash:a.stateHash,
  depositionHash:a.depositionHash,resultHash:a.resultHash};
 assert.equal(receipt.recipeHash,EXPECTED_RECIPE_HASH);
 assert.equal(receipt.rawRgbaHash,EXPECTED_RAW_RGBA_HASH);
 assert.equal(receipt.resultHash,EXPECTED_RESULT_HASH);
 {
  assert.deepEqual(await readFile(new URL('./the-interval-engine.png',import.meta.url)),Buffer.from(a.png));
  assert.equal(await readFile(new URL('./the-interval-engine.provenance.json',import.meta.url),'utf8'),a.provenanceJson);
  assert.deepEqual(JSON.parse(await readFile(new URL('./qualification.json',import.meta.url),'utf8')),receipt);
 }
 if(write){
  await mkdir(new URL('./rendered/',import.meta.url),{recursive:true});
  await writeFile(new URL('./rendered/the-interval-engine.png',import.meta.url),a.png);
  await writeFile(new URL('./rendered/the-interval-engine.provenance.json',import.meta.url),a.provenanceJson);
  await writeFile(new URL('./rendered/qualification.json',import.meta.url),JSON.stringify(receipt,null,2)+String.fromCharCode(10));
 }
 return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 await qualify({write:process.argv.includes('--write')});
}
