import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qualify,SEED,TARGET_TICK} from './qualify.mjs';
test('Original 04 pollen observatory: normalized recipe, explicit timeline, tiled FW-012 pixels',async()=>{
 const {receipt}=await qualify();
 assert.equal(receipt.seed,SEED);assert.equal(receipt.targetTick,TARGET_TICK);
 assert.equal(receipt.crop.widthPx,576);assert.equal(receipt.crop.heightPx,384);

});

test('Original 04: source-exact offline review downloads remain importable and unadmitted', async () => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { parseRecipe, serializeRecipe } = await import('../../../src/recipe/index.js');
  const { decodePngRgba, rawRgbaHash } = await import('../../../src/export/index.js');
  const { createPollenReview } = await import('./review.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'fieldweaver-original04-review-test-'));
  try {
    const result = await createPollenReview(join(directory, 'review.html'));
    assert(result.url.startsWith('file:'));
    assert.deepEqual(result.entries.map((item) => item.accepted), [true, true, false]);
    assert.equal(result.entries[2].recipeHash, '5cdf27d4b0c2e205');
    assert.equal(result.entries[2].rawRgbaHash, '194610dd7ca77ca1');
    const html = await readFile(result.output, 'utf8');
    assert.match(html, /UNMERGED CANDIDATE/);
    assert.match(html, /ACCEPTED PRESET/);
    assert.match(html, /Identity, lineage and exact framing/);
    assert.doesNotMatch(html, /<script\b|<iframe\b|src="https?:|href="https?:/i);
    const images = [...html.matchAll(/<img[^>]+src="data:image\/png;base64,([^"]+)"/g)];
    assert.equal(images.length, 3, 'two accepted real CPU proofs and one proposal');

    const download = (filename) => {
      const anchor = [...html.matchAll(/<a [^>]*>/g)]
        .map((match) => match[0])
        .find((tag) => tag.includes('download="' + filename + '"'));
      assert(anchor, 'Missing offline download: ' + filename);
      const encoded = anchor.match(/href="data:[^"]+;base64,([^"]+)"/);
      assert(encoded, 'Expected exact embedded bytes: ' + filename);
      return Buffer.from(encoded[1], 'base64');
    };
    const archivedPng = await readFile(new URL('./pollen-observatory.png', import.meta.url));
    const archivedRecipe = await readFile(new URL('./recipe.json', import.meta.url), 'utf8');
    const archivedProvenance = await readFile(
      new URL('./pollen-observatory.provenance.json', import.meta.url)
    );
    assert.deepEqual(Buffer.from(images[2][1], 'base64'), archivedPng,
      'Visible proposal does not match the archived canonical CPU image');
    assert.deepEqual(download('fieldweaver-work-3.png'), archivedPng);
    assert.deepEqual(download('fieldweaver-work-3.provenance.json'), archivedProvenance);
    const downloadedRecipe = download('fieldweaver-work-3.recipe.json').toString('utf8');
    const imported = parseRecipe(downloadedRecipe);
    assert.equal(serializeRecipe(imported), archivedRecipe,
      'Owner-downloaded recipe differs from the normalized author recipe');
    assert.deepEqual(JSON.parse(downloadedRecipe), JSON.parse(archivedRecipe));
    const sidecar = JSON.parse(archivedProvenance.toString('utf8'));
    assert.deepEqual(sidecar.recipe, imported);
    assert.equal(sidecar.seed, SEED);
    assert.equal(sidecar.targetTick, TARGET_TICK);
    assert.equal(sidecar.rawRgbaHash, '194610dd7ca77ca1');
    const decoded = decodePngRgba(archivedPng);
    assert.equal(decoded.widthPx, 576);
    assert.equal(decoded.heightPx, 384);
    assert.equal(rawRgbaHash(decoded.rgba), sidecar.rawRgbaHash);
    // runCli has already regenerated the candidate with a third tile shape,
    // checked all twenty provenance fields, and compared full decoded pixels.
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
