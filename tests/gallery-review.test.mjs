import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { decodePngRgba } from '../src/export/index.js';
import { renderExhibitionProof } from '../src/ui/exhibition-catalog.js';
import { renderReviewHtml, runCli, verifyCandidate } from '../scripts/review-gallery.mjs';

test('candidate review regenerates canonical pixels and rejects forged archive/provenance', () => {
  const accepted = renderExhibitionProof('first-weave');
  const provenance = JSON.parse(accepted.provenanceJson);
  const verified = verifyCandidate(provenance, accepted.png);
  assert.equal(verified.rawRgbaHash, accepted.rawRgbaHash);
  assert.deepEqual(verified.rgba, accepted.rgba);

  assert.throws(() => verifyCandidate({ ...provenance, rawRgbaHash: '0000000000000000' }, accepted.png), /rawRgbaHash differs/);
  assert.throws(() => verifyCandidate({ ...provenance, stateHash: '0000000000000000' }, accepted.png), /stateHash differs/);
  assert.throws(() => verifyCandidate({ ...provenance, recipeHash: '0000000000000000' }, accepted.png), /recipeHash differs/);
  assert.throws(() => verifyCandidate({ ...provenance, targetTick: 513 }, accepted.png), /tick exceeds review budget/);
  assert.throws(() => verifyCandidate({ ...provenance, crop: { ...provenance.crop, widthPx: 2000 } }, accepted.png), /pixel budget/);
  assert.throws(() => verifyCandidate({ ...provenance, version: 'fw-export-provenance-v999' }, accepted.png), /incompatible provenance version/);
  assert.throws(() => verifyCandidate(provenance, Uint8Array.of(1, 2, 3)), /PNG signature/);

  const tamperedArchive = new Uint8Array(accepted.png);
  tamperedArchive[0] ^= 0xff;
  assert.throws(() => verifyCandidate(provenance, tamperedArchive), /PNG signature/);
});

test('offline review produces a self-contained navigable comparison of accepted and nonadmitted artwork', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fieldweaver-review-'));
  try {
    const first = renderExhibitionProof('first-weave');
    const sidecarPath = join(directory, 'sample.provenance.json');
    const output = join(directory, 'review.html');
    await writeFile(sidecarPath, first.provenanceJson);
    await writeFile(join(directory, 'sample.png'), first.png);

    const result = await runCli([
      '--out', output,
      '--preset', 'operator-atlas',
      '--provenance', sidecarPath
    ]);
    assert.equal(result.entries.length, 2);
    assert.deepEqual(result.entries.map((entry) => entry.accepted), [true, false]);
    assert.equal(result.entries[1].recipeHash, first.recipeHash);
    assert.equal(result.entries[1].rawRgbaHash, first.rawRgbaHash);

    const html = await readFile(output, 'utf8');
    assert.match(html, /ACCEPTED PRESET/);
    assert.match(html, /UNMERGED CANDIDATE/);
    assert.match(html, /<nav aria-label="Jump to artwork">/);
    assert.match(html, /<details><summary>Identity, lineage and exact framing/);
    assert.match(html, /Content-Security-Policy/);
    assert.doesNotMatch(html, /<script\b|<iframe\b|src="https?:|href="https?:/i);
    assert.match(html, /data:application\/json;base64,/);
    assert.match(html, /data:image\/png;base64,/);

    const encodedImages = [...html.matchAll(/<img[^>]+src="data:image\/png;base64,([^"]+)"/g)];
    assert.equal(encodedImages.length, 2);
    const decoded = decodePngRgba(Buffer.from(encodedImages[1][1], 'base64'));
    assert.deepEqual(decoded.rgba, first.rgba, 'candidate image must be the canonical CPU proof');

    await assert.rejects(() => runCli(['--out', output, '--preset', 'first-weave']), /EEXIST/, 'existing reviews must not be overwritten');
    await assert.rejects(() => runCli(['--out', join(directory, 'missing.html'), '--provenance', join(directory, 'absent.provenance.json')]), /ENOENT/);
    await assert.rejects(() => runCli(['--out', join(directory, 'invalid.html')]), /1–8 artwork entries/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('review HTML escapes untrusted candidate labels and detects exact duplicate outputs', () => {
  const proof = renderExhibitionProof('first-weave');
  const html = renderReviewHtml([
    { title: '<img src=x onerror=alert(1)>', accepted: false, source: '<bad>', proof },
    { title: 'Same pixels', accepted: true, source: 'preset', proof }
  ]);
  assert.doesNotMatch(html, /<img src=x onerror=/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /Duplicate image identity within this review/);
  assert.match(html, /&lt;bad&gt;/);
});
