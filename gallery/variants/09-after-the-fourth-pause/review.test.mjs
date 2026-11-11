import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { decodePngRgba, rawRgbaHash } from '../../../src/export/index.js';
import { parseRecipe, serializeRecipe } from '../../../src/recipe/index.js';
import { verifyCandidate } from '../../../scripts/review-gallery.mjs';
import { buildReview } from './review.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPECTED_RGBA = '753ce0ca6b5e2aea';
const EXPECTED_RECIPE = '13451f213af22af1';

test('variant 09: one-command offline board preserves accepted status and exact imported candidate bytes', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'fw-v09-review-'));
  try {
    const output = join(temporary, 'review.html');
    const { entries } = await buildReview(output);
    assert.equal(entries.length, 3);
    assert.deepEqual(entries.map((entry) => entry.accepted), [true, true, false],
      'only shipped presets are accepted; variant 09 must remain unadmitted');
    assert.equal(entries[2].rawRgbaHash, EXPECTED_RGBA);
    assert.equal(entries[2].recipeHash, EXPECTED_RECIPE);

    const html = await readFile(output, 'utf8');
    assert.equal((html.match(/ACCEPTED PRESET/g) || []).length, 2);
    assert.equal((html.match(/UNMERGED CANDIDATE/g) || []).length, 1);
    assert(!/<script\b|<iframe\b|src="https?:/i.test(html), 'strictly offline passive review');
    assert(html.includes('Content-Security-Policy'));
    const pixels = [...html.matchAll(/<img loading="lazy" src="data:image\/png;base64,([A-Za-z0-9+/=]+)"/g)];
    assert.equal(pixels.length, 3, 'two verified accepted presets + one proposed canonical PNG');
    const selectedBytes = await readFile(join(HERE, 'selected.png'));
    const expected = decodePngRgba(selectedBytes);
    const actual = decodePngRgba(Buffer.from(pixels[2][1], 'base64'));
    assert.deepEqual(actual.rgba, expected.rgba, 'exhibition must use source-exact decoded canonical pixels');
    assert.equal(rawRgbaHash(actual.rgba), EXPECTED_RGBA);

    const recipeMatch = html.match(/href="data:application\/json;base64,([A-Za-z0-9+/=]+)" download="fieldweaver-work-3.recipe.json"/);
    assert(recipeMatch, 'candidate recipe must be directly downloadable');
    const downloaded = parseRecipe(Buffer.from(recipeMatch[1], 'base64').toString('utf8'));
    const archived = parseRecipe(await readFile(join(HERE, 'selected.recipe.json'), 'utf8'));
    assert.equal(serializeRecipe(downloaded), serializeRecipe(archived),
      'downloaded recipe must be the exact versioned authored candidate');

    const provenance = JSON.parse(await readFile(join(HERE, 'selected.provenance.json'), 'utf8'));
    const corrupted = Buffer.from(selectedBytes);
    corrupted[corrupted.length - 20] ^= 1;
    assert.throws(() => verifyCandidate(provenance, corrupted),
      'corrupted archived canonical pixels must fail closed');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
