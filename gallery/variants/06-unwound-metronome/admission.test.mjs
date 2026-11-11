import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { runCli, verifyCandidate } from '../../../scripts/review-gallery.mjs';

// Candidate-specific integration against the already-merged offline board.
// This never admits the artwork or changes the authoritative canonical output.
const root = dirname(fileURLToPath(import.meta.url));
const pngPath = join(root, 'selected.png');
const provenancePath = join(root, 'selected.provenance.json');
const RECIPE = '309ebd5fd0f01383';
const RGBA = '80a5a090d57b6d07';

test('variant 06: exact archived CPU pixels load into accepted/candidate offline board', async () => {
  const archivedPng = await readFile(pngPath);
  const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
  assert.equal(provenance.recipeHash, RECIPE);
  assert.equal(provenance.rawRgbaHash, RGBA);
  assert.equal(provenance.targetTick, 148);

  const folder = await mkdtemp(join(tmpdir(), 'fw-v06-admission-'));
  try {
    const output = join(folder, 'review.html');
    const result = await runCli([
      '--out', output,
      '--preset', 'timeline-pulse',
      '--provenance', provenancePath
    ]);
    assert.deepEqual(result.entries.map(({ accepted }) => accepted), [true, false]);
    assert.equal(result.entries[1].recipeHash, RECIPE);
    assert.equal(result.entries[1].rawRgbaHash, RGBA);

    const html = await readFile(output, 'utf8');
    assert.match(html, /ACCEPTED PRESET/);
    assert.match(html, /UNMERGED CANDIDATE/);
    assert.match(html, /Canonical software-rendered composition/);
    assert.match(html, /download="fieldweaver-work-2\.recipe\.json"/);
    assert.match(html, /download="fieldweaver-work-2\.png"/);
    assert.match(html, /download="fieldweaver-work-2\.provenance\.json"/);
    assert.ok(html.includes('data:image/png;base64,' + archivedPng.toString('base64')),
      'review must embed byte-exact selected CPU PNG, not a proxy or stale frame');
    assert.ok(html.includes(RECIPE) && html.includes(RGBA));
    assert.equal((html.match(/<article id="work-/g) ?? []).length, 2);
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
