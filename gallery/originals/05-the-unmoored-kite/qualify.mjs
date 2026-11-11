import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseRecipe, serializeRecipe, recipeHash, replayRecipeToTick } from '../../../src/recipe/index.js';
import { createCanonicalExport, decodePngRgba, rawRgbaHash } from '../../../src/export/index.js';
export const ART_ID='05-the-unmoored-kite',SEED=432525989,TICK=160,EXPECTED_RECIPE_HASH='90bd1ed3d7b6dbf5';
export async function qualify({write=false}={}){
 const text=await readFile(new URL('./recipe.json',import.meta.url),'utf8'),recipe=parseRecipe(text);
 assert.equal(serializeRecipe(recipe),text,'serialized recipe not normalized');
 assert.equal(recipeHash(recipe),EXPECTED_RECIPE_HASH);
 assert.equal(recipe.seed,SEED);assert.equal(recipe.lineage,null);
 assert.equal(recipe.fields.layers.length,7);assert.equal(recipe.emitters.length,46);
 assert.equal(recipe.commands.length,18);assert.equal(recipe.lut.assets.length,5);
 const params={targetTick:TICK,crop:recipe.framing,agentCapacity:4096,maxDepositions:250000};
 const a=createCanonicalExport(recipe,{...params,tileWidthPx:37,tileHeightPx:41});
 const b=createCanonicalExport(recipe,{...params,tileWidthPx:61,tileHeightPx:29});
 assert.deepEqual(a.rgba,b.rgba,'different tiles changed decoded pixels');
 for(const key of ['rawRgbaHash','stateHash','depositionHash','resultHash'])assert.equal(a[key],b[key],key);
 const d=decodePngRgba(a.png);
 assert.equal(d.widthPx,256);assert.equal(d.heightPx,192);
 assert.deepEqual(d.rgba,a.rgba);assert.equal(rawRgbaHash(d.rgba),a.rawRgbaHash);
 const replay=replayRecipeToTick(recipe,TICK,{capacity:4096,maxDepositions:250000});
 assert.equal(replay.resultHash(),a.resultHash);
 const mid=replayRecipeToTick(recipe,70,{capacity:4096,maxDepositions:250000});
 const round=replayRecipeToTick(parseRecipe(serializeRecipe(recipe)),70,{capacity:4096,maxDepositions:250000});
 assert.equal(round.resultHash(),mid.resultHash());assert.notEqual(replay.resultHash(),mid.resultHash());
 assert(a.depositionCount>1000&&a.depositionCount<250000);
 const receipt={artwork:ART_ID,seed:SEED,recipeHash:recipeHash(recipe),targetTick:TICK,crop:recipe.framing,depositionCount:a.depositionCount,rawRgbaHash:a.rawRgbaHash,stateHash:a.stateHash,depositionHash:a.depositionHash,resultHash:a.resultHash};
 const expected={recipeHash:'90bd1ed3d7b6dbf5',rawRgbaHash:'ded31b12f6efd7dc',
 stateHash:'5f630c24020ee1ea',depositionHash:'66d14f1ff1226488',resultHash:'81552f777588879c',depositionCount:20451};
 for(const [key,value] of Object.entries(expected))assert.equal(receipt[key],value,'golden '+key);
 assert.deepEqual(await readFile(new URL('./the-unmoored-kite.png',import.meta.url)),Buffer.from(a.png),'archived CPU PNG differs');
 assert.equal(await readFile(new URL('./the-unmoored-kite.provenance.json',import.meta.url),'utf8'),a.provenanceJson,'archived sidecar differs');
 assert.deepEqual(JSON.parse(await readFile(new URL('./qualification.json',import.meta.url),'utf8')),receipt,'archived receipt differs');
 if(write){
  await writeFile(new URL('./the-unmoored-kite.png',import.meta.url),a.png);
  await writeFile(new URL('./the-unmoored-kite.provenance.json',import.meta.url),a.provenanceJson);
  await writeFile(new URL('./qualification.json',import.meta.url),JSON.stringify(receipt,null,2)+'\n');
 }
 return {receipt,png:a.png,provenanceJson:a.provenanceJson};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {receipt}=await qualify({write:process.argv.includes('--write')});console.log(JSON.stringify(receipt));
}
