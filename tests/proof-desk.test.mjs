import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { createCanonicalExport } from '../src/export/index.js';
import { getBuiltinPreset } from '../src/presets/index.js';
import { recipeHash } from '../src/recipe/index.js';
import { PROOF_DESK_LIMITS, verifyProofPackage } from '../src/ui/proof-desk-verify.js';

const preset = getBuiltinPreset('first-weave');
const source = createCanonicalExport(preset.recipe, {
  targetTick: preset.targetTick,
  crop: preset.exportCrop,
  agentCapacity: 4096,
  maxDepositions: 250_000,
  tileWidthPx: 32,
  tileHeightPx: 32
});

test('provenance desk independently replays golden accepted work and verifies supplied PNG pixels', () => {
  const before = recipeHash(preset.recipe);
  const checked = verifyProofPackage(source.provenance, source.png);
  assert.equal(checked.archivedPngChecked, true);
  assert.equal(checked.proof.rawRgbaHash, '8d83d52e732a5825');
  assert.equal(checked.proof.rawRgbaHash, source.rawRgbaHash);
  assert.equal(checked.proof.stateHash, source.stateHash);
  assert.equal(checked.proof.depositionHash, source.depositionHash);
  assert.equal(checked.proof.resultHash, source.resultHash);
  assert.deepEqual(checked.proof.rgba, source.rgba);
  assert.deepEqual(checked.proof.provenance, source.provenance);
  assert.equal(recipeHash(preset.recipe), before, 'review must never mutate the accepted recipe');
  assert.equal(verifyProofPackage(source.provenance).archivedPngChecked, false);
});

function tamper(field, value) {
  return { ...structuredClone(source.provenance), [field]: value };
}

test('proof desk rejects forged source identities, claims and schema without rendering substitutes', () => {
  assert.throws(() => verifyProofPackage({}), /Unsupported canonical provenance/);
  assert.throws(() => verifyProofPackage(tamper('version', 'future')), /Unsupported canonical provenance/);
  assert.throws(() => verifyProofPackage(tamper('recipeHash', '0000000000000000')), /Recipe hash/);
  assert.throws(() => verifyProofPackage(tamper('rawRgbaHash', '0000000000000000')), /rawRgbaHash/);
  assert.throws(() => verifyProofPackage(tamper('stateHash', '0000000000000000')), /stateHash/);
  assert.throws(() => verifyProofPackage(tamper('backgroundRgba8', [5, 6, 7, 255])), /rawRgbaHash|backgroundRgba8/);
  assert.throws(() => verifyProofPackage({ ...source.provenance, invented: 'trusted' }), /field set/);
  assert.throws(() => verifyProofPackage(tamper('targetTick', PROOF_DESK_LIMITS.maxTick + 1)), /tick.*budget/);
  assert.throws(() => verifyProofPackage(tamper('crop', { ...source.crop, widthPx: 1025 })), /Crop exceeds/);
  assert.throws(() => verifyProofPackage(tamper('crop', { ...source.crop, widthPx: 1024, heightPx: 1024 + 1 })), /Crop exceeds/);
});

test('proof desk treats optional native PNG as independent evidence, not a presentational proxy', () => {
  const damaged = Uint8Array.from(source.png);
  damaged[damaged.length - 15] ^= 1;
  assert.throws(() => verifyProofPackage(source.provenance, damaged), /CRC|Adler|differs/);
  assert.throws(() => verifyProofPackage(source.provenance, new Uint8Array(32)), /truncated/);
  assert.throws(() => verifyProofPackage(source.provenance, new Uint8Array(PROOF_DESK_LIMITS.pngBytes + 1)), /8 MiB/);
});

test('canonical export UI links locally to the independent proof desk without remote dependencies', async () => {
  const exportPanel = await readFile(new URL('../src/ui/export-panel.js', import.meta.url), 'utf8');
  const proofHtml = await readFile(new URL('../proof-desk.html', import.meta.url), 'utf8');
  assert.match(exportPanel, /href: '\.\/proof-desk\.html'/);
  assert.match(proofHtml, /src="\.\/src\/ui\/proof-desk\.js"/);
  assert.match(proofHtml, /Content-Security-Policy/);
  assert.doesNotMatch(proofHtml, /(?:href|src)="https?:\/\//);
});
