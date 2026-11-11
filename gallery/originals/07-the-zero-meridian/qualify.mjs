import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseRecipe,serializeRecipe,recipeHash,replayRecipeToTick} from '../../../src/recipe/index.js';
import {createCanonicalExport,decodePngRgba,rawRgbaHash} from '../../../src/export/index.js';
import {ART_ID,TARGET_TICK,createZeroMeridian,authoredRecipeText} from './author.mjs';
export async function qualify({write=false,archived=false}={}){
 const recipe=createZeroMeridian(),text=authoredRecipeText();
 assert.equal(serializeRecipe(parseRecipe(text)),text);
 assert.equal(recipe.seed,0x5ce73a19);assert.equal(recipe.lineage,null);
 assert.equal(recipe.fields.layers.length,7);assert.equal(recipe.lut.assets.length,5);
 assert.equal(recipe.commands.length,16);assert(recipe.emitters.length>=70);
 const params={targetTick:TARGET_TICK,crop:recipe.framing,agentCapacity:4096,maxDepositions:250000};
 const a=createCanonicalExport(recipe,{...params,tileWidthPx:47,tileHeightPx:41});
 const b=createCanonicalExport(recipe,{...params,tileWidthPx:71,tileHeightPx:53});
 assert.deepEqual(a.rgba,b.rgba,'tile geometry changed canonical output');
 for(const key of ['rawRgbaHash','stateHash','depositionHash','resultHash'])assert.equal(a[key],b[key],key);
 const decoded=decodePngRgba(a.png);
 assert.equal(decoded.widthPx,352);assert.equal(decoded.heightPx,288);
 assert.deepEqual(decoded.rgba,a.rgba);
 assert.equal(rawRgbaHash(decoded.rgba),a.rawRgbaHash);
 const early=replayRecipeToTick(recipe,69,{capacity:4096,maxDepositions:250000});
 const round=replayRecipeToTick(parseRecipe(text),69,{capacity:4096,maxDepositions:250000});
 assert.equal(early.resultHash(),round.resultHash(),'mid-replay recipe roundtrip changed state');
 assert.notEqual(early.resultHash(),a.resultHash,'no temporal evolution');
 const occupied=(()=>{let n=0;for(let i=0;i<a.rgba.length;i+=4)
 if(a.rgba[i]!==9||a.rgba[i+1]!==11||a.rgba[i+2]!==8)n++;return n;})();
 assert(occupied>450,'insufficient canonical visible material');
 assert(a.depositionCount>1000&&a.depositionCount<250000);
 const receipt={artwork:ART_ID,seed:recipe.seed,recipeHash:recipeHash(recipe),targetTick:TARGET_TICK,crop:recipe.framing,
  emitters:recipe.emitters.length,occupiedPixels:occupied,depositionCount:a.depositionCount,
  rawRgbaHash:a.rawRgbaHash,stateHash:a.stateHash,depositionHash:a.depositionHash,resultHash:a.resultHash};
 const golden={recipeHash:'002a783e5492a7d5',rawRgbaHash:'20d0367ebe3a8d8e',stateHash:'392c1dc87f4f73df',depositionHash:'6d062421d2acc4e2',resultHash:'9f3193bbf43aa545',occupiedPixels:3041,depositionCount:9630,emitters:100};
 for(const [key,value] of Object.entries(golden))assert.equal(receipt[key],value,'canonical golden '+key);
 if(archived){
  assert.equal(await readFile(new URL('./recipe.json',import.meta.url),'utf8'),text);
  assert.deepEqual(await readFile(new URL('./the-zero-meridian.png',import.meta.url)),Buffer.from(a.png));
  assert.equal(await readFile(new URL('./the-zero-meridian.provenance.json',import.meta.url),'utf8'),a.provenanceJson);
  assert.deepEqual(JSON.parse(await readFile(new URL('./qualification.json',import.meta.url),'utf8')),receipt);
 }
 if(write){
  await writeFile(new URL('./recipe.json',import.meta.url),text);
  await writeFile(new URL('./the-zero-meridian.png',import.meta.url),a.png);
  await writeFile(new URL('./the-zero-meridian.provenance.json',import.meta.url),a.provenanceJson);
  await writeFile(new URL('./qualification.json',import.meta.url),JSON.stringify(receipt,null,2)+'\n');
 }
 return {receipt,recipeText:text,png:a.png,provenanceJson:a.provenanceJson};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {receipt}=await qualify({write:process.argv.includes('--write'),archived:process.argv.includes('--archived')});
 console.log(JSON.stringify(receipt));
}
