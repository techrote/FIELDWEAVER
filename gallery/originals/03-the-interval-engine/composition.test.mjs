import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qualify,SEED,TARGET_TICK} from './qualify.mjs';
test('Original 03 interval engine: normalized recipe, independent tiled canonical replay, PNG roundtrip',async()=>{
 const receipt=await qualify();
 assert.equal(receipt.seed,SEED);assert.equal(receipt.targetTick,TARGET_TICK);
 assert.equal(receipt.crop.widthPx,512);assert.equal(receipt.crop.heightPx,384);
});

test('Original 03: offline review exposes exact archived CPU art and loadable recipe without admission', async () => {
 const {mkdtemp, readFile, rm} = await import('node:fs/promises');
 const {tmpdir} = await import('node:os');
 const {join} = await import('node:path');
 const {parseRecipe, serializeRecipe} = await import('../../../src/recipe/index.js');
 const {decodePngRgba, rawRgbaHash} = await import('../../../src/export/index.js');
 const {createIntervalReview} = await import('./review.mjs');
 const folder = await mkdtemp(join(tmpdir(), 'fieldweaver-original03-review-test-'));
 try {
  const result = await createIntervalReview(join(folder, 'review.html'));
  assert(result.url.startsWith('file:'));
  assert.deepEqual(result.entries.map((item) => item.accepted), [true, true, false]);
  assert.equal(result.entries[2].recipeHash, '4adb2abba8c7999f');
  assert.equal(result.entries[2].rawRgbaHash, 'fd389a9bb0ce640f');
  const html = await readFile(result.output, 'utf8');
  assert.match(html, /UNMERGED CANDIDATE/);
  assert.match(html, /ACCEPTED PRESET/);
  assert.match(html, /Identity, lineage and exact framing/);
  assert.doesNotMatch(html, /<script\b|<iframe\b|src="https?:|href="https?:/i);
  const images = [...html.matchAll(/<img[^>]+src="data:image\/png;base64,([^"]+)"/g)];
  assert.equal(images.length, 3);
  const download = (filename) => {
   const anchor = [...html.matchAll(/<a [^>]*>/g)]
     .map((match) => match[0])
     .find((tag) => tag.includes('download="' + filename + '"'));
   assert(anchor, 'Missing offline download: ' + filename);
   const payload = anchor.match(/href="data:[^"]+;base64,([^"]+)"/);
   assert(payload, 'Missing embedded bytes: ' + filename);
   return Buffer.from(payload[1], 'base64');
  };
  const png = await readFile(new URL('./the-interval-engine.png', import.meta.url));
  const recipe = await readFile(new URL('./recipe.json', import.meta.url), 'utf8');
  const provenance = await readFile(new URL('./the-interval-engine.provenance.json', import.meta.url));
  assert.deepEqual(Buffer.from(images[2][1], 'base64'), png);
  assert.deepEqual(download('fieldweaver-work-3.png'), png);
  assert.deepEqual(download('fieldweaver-work-3.provenance.json'), provenance);
  const imported = parseRecipe(download('fieldweaver-work-3.recipe.json').toString('utf8'));
  assert.equal(serializeRecipe(imported), recipe);
  const sidecar = JSON.parse(provenance.toString('utf8'));
  assert.deepEqual(sidecar.recipe, imported);
  assert.equal(sidecar.seed, SEED);
  assert.equal(sidecar.targetTick, TARGET_TICK);
  const decoded = decodePngRgba(png);
  assert.equal(decoded.widthPx, 512);
  assert.equal(decoded.heightPx, 384);
  assert.equal(rawRgbaHash(decoded.rgba), sidecar.rawRgbaHash);
  // The review generator has independently replayed all twenty provenance
  // identity fields and compared a third raster tiling with decoded pixels.
 } finally {
  await rm(folder, {recursive:true, force:true});
 }
});
