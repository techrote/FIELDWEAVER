// Artwork-only canonical qualification; source simulation/export modules remain authoritative.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseRecipe, serializeRecipe, recipeHash, replayRecipeToTick } from '../../../src/recipe/index.js';
import { createCanonicalExport, decodePngRgba, rawRgbaHash } from '../../../src/export/index.js';

export const ARTWORK_ID = '02-the-luminous-ledger';
export const TARGET_TICK = 168;
export const EXPECTED_RECIPE_HASH = 'e60f9467e69750b9';
export const EXPECTED_RAW_RGBA_HASH = '3b821e3737598e0a';
export const EXPECTED_RESULT_HASH = '8ff150b7d713ab3c';
export const SEED = 1800529875;
export const CAPACITY = 4096;
export const MAX_DEPOSITIONS = 250000;

export async function qualifyArtwork({ write = false } = {}) {
  const source = await readFile(new URL('./recipe.json', import.meta.url), 'utf8');
  const recipe = parseRecipe(source);
  assert.equal(serializeRecipe(recipe), source, 'recipe.json is not normalized');
  assert.equal(recipe.seed, SEED);
  assert.equal(recipeHash(recipe), EXPECTED_RECIPE_HASH, 'recipe golden mismatch');
  assert.equal(recipe.schemaVersion, 'fw-recipe-v1');
  assert.equal(recipe.engineVersion, 'fw-agents-v1');
  assert.equal(recipe.lineage, null, 'Original work must have no mutation parent');
  assert.equal(recipe.fields.layers.length, 6);
  assert.equal(recipe.emitters.length, 16);
  assert.equal(recipe.commands.length, 15);
  assert.deepEqual(recipe.commands.map(command => command.id), [10,20,30,40,50,60,70,80,90,100,110,120,130,140,150]);
  const options = { targetTick: TARGET_TICK, crop: recipe.framing,
    agentCapacity: CAPACITY, maxDepositions: MAX_DEPOSITIONS };
  const first = createCanonicalExport(recipe, { ...options, tileWidthPx: 47, tileHeightPx: 39 });
  const second = createCanonicalExport(recipe, { ...options, tileWidthPx: 89, tileHeightPx: 73 });
  assert.deepEqual(first.rgba, second.rgba, 'tile shape changed pixels');
  for (const name of ['rawRgbaHash','stateHash','depositionHash','resultHash']) {
    assert.equal(first[name], second[name], name + ' unstable');
  }
  const decoded = decodePngRgba(first.png);
  assert.equal(decoded.widthPx, recipe.framing.widthPx);
  assert.equal(decoded.heightPx, recipe.framing.heightPx);
  assert.deepEqual(decoded.rgba, first.rgba, 'PNG roundtrip changed raw pixels');
  assert.equal(rawRgbaHash(decoded.rgba), first.rawRgbaHash);
  const replay = replayRecipeToTick(recipe, TARGET_TICK, {capacity: CAPACITY, maxDepositions: MAX_DEPOSITIONS});
  assert.equal(replay.stateHash(), first.stateHash);
  assert.equal(replay.depositionHash(), first.depositionHash);
  assert.equal(replay.resultHash(), first.resultHash);
  const mid = replayRecipeToTick(recipe, 80, {capacity: CAPACITY, maxDepositions: MAX_DEPOSITIONS});
  const mid2 = replayRecipeToTick(parseRecipe(serializeRecipe(recipe)), 80,
    {capacity: CAPACITY, maxDepositions: MAX_DEPOSITIONS});
  assert.equal(mid.resultHash(), mid2.resultHash(), 'mid-composition replay drifted after roundtrip');
  assert.notEqual(mid.resultHash(), first.resultHash, 'interventions failed to advance the composition');
  assert(first.depositionCount > 500, 'not enough marks generated');
  assert.equal(first.rawRgbaHash, EXPECTED_RAW_RGBA_HASH, 'canonical RGBA golden mismatch');
  assert.equal(first.resultHash, EXPECTED_RESULT_HASH, 'canonical replay golden mismatch');
  assert(first.depositionCount < MAX_DEPOSITIONS, 'deposition cap exhausted');
  const receipt = {
    artwork: ARTWORK_ID, recipeHash: recipeHash(recipe), seed: SEED, targetTick: TARGET_TICK,
    crop: recipe.framing, depositionCount: first.depositionCount, rawRgbaHash: first.rawRgbaHash,
    stateHash: first.stateHash, depositionHash: first.depositionHash, resultHash: first.resultHash
  };
  const outputPng = new URL('./the-luminous-ledger.png', import.meta.url);
  const outputProvenance = new URL('./the-luminous-ledger.provenance.json', import.meta.url);
  const outputReceipt = new URL('./qualification.json', import.meta.url);
  assert.deepEqual(await readFile(outputPng), Buffer.from(first.png), 'archived PNG != canonical renderer');
  assert.equal(await readFile(outputProvenance, 'utf8'), first.provenanceJson, 'provenance mismatch');
  const archived = JSON.parse(await readFile(outputReceipt, 'utf8'));
  assert.deepEqual(archived, receipt, 'qualification receipt differs');
  if (write) {
    await mkdir(new URL('./rendered/', import.meta.url), { recursive: true });
    await writeFile(new URL('./rendered/the-luminous-ledger.png', import.meta.url), first.png);
    await writeFile(new URL('./rendered/the-luminous-ledger.provenance.json', import.meta.url), first.provenanceJson);
    await writeFile(new URL('./rendered/qualification.json', import.meta.url), JSON.stringify(receipt,null,2) + '\n');
  }
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if(args.some(arg=>arg!=='--write')) throw new RangeError('Only --write is supported');
  const receipt=await qualifyArtwork({write:args.includes('--write')});
  console.log(JSON.stringify(receipt,null,2));
}
