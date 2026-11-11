import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { verifyCandidate } from '../../../scripts/review-gallery.mjs';
import { buildReview } from './review.mjs';

// Candidate-specific integration against the already-merged offline board.
// This never admits the artwork or changes the authoritative canonical output.
const root = dirname(fileURLToPath(import.meta.url));
const pngPath = join(root, 'selected.png');
const provenancePath = join(root, 'selected.provenance.json');
const RECIPE = '309ebd5fd0f01383';
const RGBA = '80a5a090d57b6d07';

test('variant 06: one-command accepted/candidate board embeds exact archived CPU pixels', async () => {
  const archivedPng = await readFile(pngPath);
  const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
  assert.equal(provenance.recipeHash, RECIPE);
  assert.equal(provenance.rawRgbaHash, RGBA);
  assert.equal(provenance.targetTick, 148);

  const folder = await mkdtemp(join(tmpdir(), 'fw-v06-admission-'));
  try {
    const output = join(folder, 'review.html');
    const result = await buildReview(output);
    assert.deepEqual(result.entries.map(({ accepted }) => accepted), [true, true, false]);
    assert.equal(result.entries[2].recipeHash, RECIPE);
    assert.equal(result.entries[2].rawRgbaHash, RGBA);

    const html = await readFile(output, 'utf8');
    assert.match(html, /ACCEPTED PRESET/);
    assert.match(html, /UNMERGED CANDIDATE/);
    assert.match(html, /Canonical software-rendered composition/);
    assert.match(html, /download="fieldweaver-work-3\.recipe\.json"/);
    assert.match(html, /download="fieldweaver-work-3\.png"/);
    assert.match(html, /download="fieldweaver-work-3\.provenance\.json"/);
    assert.ok(html.includes('data:image/png;base64,' + archivedPng.toString('base64')),
      'review must embed byte-exact selected CPU PNG, not a proxy or stale frame');
    assert.ok(html.includes(RECIPE) && html.includes(RGBA));
    // The downloadable payloads must be the selected canonical artwork, not
    // merely links with the expected filenames or stale accepted-preset data.
    const pngDownload = [...html.matchAll(/<a href="data:image\\/png;base64,([A-Za-z0-9+/=]+)" download="fieldweaver-work-3\\.png">/g)];
    assert.equal(pngDownload.length, 1, 'exactly one candidate PNG download');
    assert.deepEqual(Buffer.from(pngDownload[0][1], 'base64'), archivedPng,
      'downloaded PNG must match archived canonical bytes');

    const jsonDownloads = [...html.matchAll(/<a href="data:application\\/json;base64,([A-Za-z0-9+/=]+)" download="fieldweaver-work-3\\.(recipe|provenance)\\.json">/g)];
    assert.equal(jsonDownloads.length, 2, 'candidate recipe and provenance must each be downloadable');
    const payloads = Object.fromEntries(jsonDownloads.map(([, encoded, kind]) =>
      [kind, JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))]));
    assert.deepEqual(payloads.recipe,
      JSON.parse(await readFile(join(root, 'selected.recipe.json'), 'utf8')),
      'downloadable normalized recipe must match the selected archived child');
    assert.deepEqual(payloads.provenance, provenance,
      'downloadable provenance must match the selected archived FW-012 receipt');
    assert.equal(payloads.provenance.recipeHash, RECIPE);
    assert.equal(payloads.provenance.rawRgbaHash, RGBA);
    assert.equal((html.match(/<article id="work-/g) ?? []).length, 3);
    assert.doesNotMatch(html, /<script\b|<iframe\b|<img[^>]*src="https?:/i);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('variant 06: review rejects stale provenance and corrupted canonical PNG', async () => {
  const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
  const png = await readFile(pngPath);
  assert.throws(
    () => verifyCandidate({ ...provenance, rawRgbaHash: 'ffffffffffffffff' }, png),
    /rawRgbaHash differs from exact CPU replay/
  );
  const corrupt = Buffer.from(png);
  corrupt[corrupt.length - 20] ^= 1;
  assert.throws(() => verifyCandidate(provenance, corrupt),
    /PNG|CRC|checksum|decode|canonical|RGBA/i);
});
