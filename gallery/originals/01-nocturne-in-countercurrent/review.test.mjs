import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseRecipe, serializeRecipe } from '../../../src/recipe/index.js';
import { decodePngRgba, rawRgbaHash } from '../../../src/export/index.js';
import { createNocturneReview } from './review.mjs';

test('Original 01 offline review verifies actual archive downloads, import and CPU pixels without admission', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fw-nocturne-review-test-'));
  try {
    const result = await createNocturneReview(join(dir, 'review.html'));
    assert(result.url.startsWith('file:'));
    assert.deepEqual(result.entries.map(item => item.accepted), [true, true, false]);
    assert.equal(result.entries[2].recipeHash, 'ee1696765f96ef0c');
    assert.equal(result.entries[2].rawRgbaHash, '1427da2094a6b26a');

    const html = await readFile(result.output, 'utf8');
    assert.match(html, /ACCEPTED PRESET/);
    assert.match(html, /UNMERGED CANDIDATE/);
    assert.doesNotMatch(html, /<script\b|<iframe\b|src="https?:|href="https?:/i);
    const images = [...html.matchAll(/<img[^>]+src="data:image\/png;base64,([^"]+)"/g)];
    assert.equal(images.length, 3);

    function download(name) {
      const tag = [...html.matchAll(/<a [^>]*>/g)].map(x => x[0])
        .find(x => x.includes('download="' + name + '"'));
      assert(tag, 'Missing downloadable ' + name);
      const data = tag.match(/href="data:[^"]+;base64,([^"]+)"/);
      assert(data, 'Missing embedded bytes for ' + name);
      return Buffer.from(data[1], 'base64');
    }

    const png = await readFile(new URL('./nocturne-in-countercurrent.png', import.meta.url));
    const provenance = await readFile(new URL('./nocturne-in-countercurrent.provenance.json', import.meta.url));
    const recipeText = await readFile(new URL('./recipe.json', import.meta.url), 'utf8');
    assert.deepEqual(Buffer.from(images[2][1], 'base64'), png);
    assert.deepEqual(download('fieldweaver-work-3.png'), png);
    assert.deepEqual(download('fieldweaver-work-3.provenance.json'), provenance);

    const imported = parseRecipe(download('fieldweaver-work-3.recipe.json').toString('utf8'));
    assert.equal(serializeRecipe(imported), recipeText);
    const sidecar = JSON.parse(provenance.toString('utf8'));
    assert.deepEqual(imported, sidecar.recipe);
    assert.equal(sidecar.targetTick, 156);
    assert.equal(sidecar.seed, 2010505889);
    const decoded = decodePngRgba(png);
    assert.equal(decoded.widthPx, 512);
    assert.equal(decoded.heightPx, 320);
    assert.equal(rawRgbaHash(decoded.rgba), '1427da2094a6b26a');
    // runCli also performs independent third-tiling canonical CPU replay of
    // state, deposition, result, provenance and decoded archived pixels.
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
