import assert from 'node:assert/strict';
import test from 'node:test';
import { qualifyArtwork, SEED, TARGET_TICK, ARTWORK_ID, EXPECTED_RECIPE_HASH, EXPECTED_RAW_RGBA_HASH, EXPECTED_RESULT_HASH } from './qualify.mjs';

test('FIELDWEAVER original: Luminous Ledger canonical archive and deterministic replay', async () => {
  const receipt = await qualifyArtwork();
  assert.equal(receipt.artwork, ARTWORK_ID);
  assert.equal(receipt.seed, SEED);
  assert.equal(receipt.targetTick, TARGET_TICK);
  assert.equal(receipt.recipeHash, EXPECTED_RECIPE_HASH);
  assert.equal(receipt.rawRgbaHash, EXPECTED_RAW_RGBA_HASH);
  assert.equal(receipt.resultHash, EXPECTED_RESULT_HASH);
  assert.equal(receipt.crop.widthPx, 448);
  assert.equal(receipt.crop.heightPx, 448);
  console.log('FW original archive qualification: ' + JSON.stringify(receipt));
});

test('Original 02 offline review verifies archived pixels, downloads and editable import without admission', async () => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { parseRecipe, serializeRecipe } = await import('../../../src/recipe/index.js');
  const { decodePngRgba, rawRgbaHash } = await import('../../../src/export/index.js');
  const { createLedgerReview } = await import('./review.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'fw-ledger-review-test-'));
  try {
    const result = await createLedgerReview(join(dir, 'review.html'));
    assert(result.url.startsWith('file:'));
    assert.deepEqual(result.entries.map(item => item.accepted), [true, true, false]);
    assert.equal(result.entries[2].recipeHash, EXPECTED_RECIPE_HASH);
    assert.equal(result.entries[2].rawRgbaHash, EXPECTED_RAW_RGBA_HASH);
    const html = await readFile(result.output, 'utf8');
    assert.match(html, /ACCEPTED PRESET/);
    assert.match(html, /UNMERGED CANDIDATE/);
    assert.doesNotMatch(html, /<script\\b|<iframe\\b|src="https?:|href="https?:/i);
    const imgs = [...html.matchAll(/<img[^>]+src="data:image\\/png;base64,([^"]+)"/g)];
    assert.equal(imgs.length, 3);
    function download(name) {
      const tag = [...html.matchAll(/<a [^>]*>/g)].map(x => x[0])
        .find(x => x.includes('download="' + name + '"'));
      assert(tag, 'Missing download ' + name);
      const encoded = tag.match(/href="data:[^"]+;base64,([^"]+)"/);
      assert(encoded, 'Missing download bytes ' + name);
      return Buffer.from(encoded[1], 'base64');
    }
    const png = await readFile(new URL('./the-luminous-ledger.png', import.meta.url));
    const recipeText = await readFile(new URL('./recipe.json', import.meta.url), 'utf8');
    const provenance = await readFile(new URL('./the-luminous-ledger.provenance.json', import.meta.url));
    assert.deepEqual(Buffer.from(imgs[2][1], 'base64'), png);
    assert.deepEqual(download('fieldweaver-work-3.png'), png);
    assert.deepEqual(download('fieldweaver-work-3.provenance.json'), provenance);
    const recipe = parseRecipe(download('fieldweaver-work-3.recipe.json').toString('utf8'));
    assert.equal(serializeRecipe(recipe), recipeText);
    const sidecar = JSON.parse(provenance.toString('utf8'));
    assert.deepEqual(recipe, sidecar.recipe);
    assert.equal(sidecar.seed, SEED);
    assert.equal(sidecar.targetTick, TARGET_TICK);
    const decoded = decodePngRgba(png);
    assert.equal(decoded.widthPx, 448);
    assert.equal(decoded.heightPx, 448);
    assert.equal(rawRgbaHash(decoded.rgba), EXPECTED_RAW_RGBA_HASH);
    // runCli independently verifies every provenance field and third-tiling CPU pixels.
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
