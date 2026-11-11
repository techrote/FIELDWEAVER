// Artwork-specific canonical admission tool. No renderer or simulation semantics are reimplemented here.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  parseRecipe, recipeHash, serializeRecipe, replayRecipeToTick
} from '../../../src/recipe/index.js';
import {
  createCanonicalExport, decodePngRgba, rawRgbaHash
} from '../../../src/export/index.js';

export const ARTWORK_ID = '01-nocturne-in-countercurrent';
export const TARGET_TICK = 156;
export const EXPECTED_RECIPE_HASH = 'ee1696765f96ef0c';
const AGENT_CAPACITY = 4096;
const MAX_DEPOSITIONS = 250000;
const recipeUrl = new URL('./recipe.json', import.meta.url);

export async function qualifyArtwork({ write = false } = {}) {
  const text = await readFile(recipeUrl, 'utf8');
  const recipe = parseRecipe(text);
  assert.equal(serializeRecipe(recipe), text, 'recipe.json must be precisely normalized');
  const identity = recipeHash(recipe);
  assert.equal(identity, EXPECTED_RECIPE_HASH, 'authoritative recipe identity changed');
  assert.equal(recipe.schemaVersion, 'fw-recipe-v1');
  assert.equal(recipe.engineVersion, 'fw-agents-v1');
  assert.equal(recipe.commands.length, 13);
  assert.deepEqual(recipe.commands.map((command) => command.id), [
    10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130
  ]);

  const options = {
    targetTick: TARGET_TICK,
    crop: recipe.framing,
    agentCapacity: AGENT_CAPACITY,
    maxDepositions: MAX_DEPOSITIONS
  };
  const first = createCanonicalExport(recipe, {
    ...options, tileWidthPx: 61, tileHeightPx: 43
  });
  const second = createCanonicalExport(recipe, {
    ...options, tileWidthPx: 113, tileHeightPx: 79
  });
  assert.equal(first.rawRgbaHash, second.rawRgbaHash, 'tile layout changed canonical pixels');
  assert.equal(first.stateHash, second.stateHash, 'replay state changed');
  assert.equal(first.depositionHash, second.depositionHash, 'depositions changed');
  assert.equal(first.resultHash, second.resultHash, 'canonical result changed');
  assert.deepEqual(first.rgba, second.rgba, 'full pixel buffer differs across tile shapes');
  assert(first.depositionCount > 100, 'composition generated too few depositions');

  const decoded = decodePngRgba(first.png);
  assert.equal(decoded.widthPx, recipe.framing.widthPx);
  assert.equal(decoded.heightPx, recipe.framing.heightPx);
  assert.deepEqual(decoded.rgba, first.rgba, 'PNG round trip altered raw pixels');
  assert.equal(rawRgbaHash(decoded.rgba), first.rawRgbaHash);
  const replay = replayRecipeToTick(recipe, TARGET_TICK, {
    capacity: AGENT_CAPACITY, maxDepositions: MAX_DEPOSITIONS
  });
  assert.equal(replay.stateHash(), first.stateHash);
  assert.equal(replay.depositionHash(), first.depositionHash);
  assert.equal(replay.resultHash(), first.resultHash);
  assert.equal(first.provenance.recipeHash, identity);
  assert.equal(first.provenance.rawRgbaHash, first.rawRgbaHash);
  assert.equal(first.provenance.targetTick, TARGET_TICK);
  // The checked-in artwork must be byte-for-byte identical to the actual canonical export.
  const archivedPng = await readFile(new URL('./nocturne-in-countercurrent.png', import.meta.url));
  const archivedProvenance = await readFile(new URL('./nocturne-in-countercurrent.provenance.json', import.meta.url), 'utf8');
  const archivedReceipt = JSON.parse(await readFile(new URL('./qualification.json', import.meta.url), 'utf8'));
  assert.deepEqual(archivedPng, Buffer.from(first.png), 'checked-in PNG differs from canonical output');
  assert.equal(archivedProvenance, first.provenanceJson, 'checked-in FW-012 provenance differs from canonical export');
  assert.equal(archivedReceipt.rawRgbaHash, first.rawRgbaHash);
  assert.equal(archivedReceipt.stateHash, first.stateHash);
  assert.equal(archivedReceipt.depositionHash, first.depositionHash);
  assert.equal(archivedReceipt.resultHash, first.resultHash);
  assert.equal(archivedReceipt.depositionCount, first.depositionCount);


  const receipt = {
    artwork: ARTWORK_ID,
    qualification: 'canonical software replay, dual tile shapes, PNG decode, normalized recipe',
    recipeHash: identity,
    seed: recipe.seed,
    targetTick: TARGET_TICK,
    crop: recipe.framing,
    depositionCount: first.depositionCount,
    rawRgbaHash: first.rawRgbaHash,
    stateHash: first.stateHash,
    depositionHash: first.depositionHash,
    resultHash: first.resultHash
  };
  if (write) {
    const outDir = new URL('./rendered/', import.meta.url);
    await mkdir(outDir, { recursive: true });
    await writeFile(new URL('./rendered/nocturne-in-countercurrent.png', import.meta.url), first.png);
    await writeFile(new URL('./rendered/nocturne-in-countercurrent.provenance.json', import.meta.url), first.provenanceJson);
    await writeFile(new URL('./rendered/qualification.json', import.meta.url), JSON.stringify(receipt, null, 2) + '\n');
  }
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--write'].includes(arg))) {
    throw new RangeError('Only --write is supported. The default is read-only verification.');
  }
  const receipt = await qualifyArtwork({ write: args.includes('--write') });
  process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
}
