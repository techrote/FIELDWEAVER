import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { recipeHash } from '../src/recipe/index.js';
import { BUILTIN_PRESETS } from '../src/presets/index.js';
import { exhibitionEntries, renderExhibitionProof } from '../src/ui/exhibition-catalog.js';
import { renderVisualIndexProof, verifyVisualIndexProof } from '../src/ui/exhibition-visual-index-model.js';

test('visual index decodes all accepted CPU proofs at golden tick/crop without editing recipes', async () => {
  const fixtures = JSON.parse(await readFile(new URL('../fixtures/fw-014-presets.json', import.meta.url), 'utf8'));
  const before = BUILTIN_PRESETS.map((preset) => recipeHash(preset.recipe));
  const entries = exhibitionEntries();
  assert.equal(entries.length, 4);
  for (const entry of entries) {
    const tile = renderVisualIndexProof(entry.id);
    assert.equal(tile.name, entry.name);
    assert.equal(tile.seed, entry.seed);
    assert.equal(tile.recipeHash, entry.recipeHash);
    assert.equal(tile.targetTick, entry.targetTick);
    assert.equal(tile.widthPx, entry.exportCrop.widthPx);
    assert.equal(tile.heightPx, entry.exportCrop.heightPx);
    assert.equal(tile.rawRgbaHash, fixtures.presets[entry.id].rawRgbaHash);
    assert.ok(tile.png.length > 256, 'real PNG bytes are required');
    assert(Object.isFrozen(tile));
  }
  assert.deepEqual(BUILTIN_PRESETS.map((preset) => recipeHash(preset.recipe)), before);
});

test('visual index rejects corrupted canonical images, proxy identities and forged receipts', () => {
  const proof = renderExhibitionProof('first-weave');
  const corrupted = proof.png.slice();
  corrupted[corrupted.length - 8] ^= 1;
  assert.throws(() => verifyVisualIndexProof('first-weave', { ...proof, png: corrupted }), /PNG|CRC|IEND/);
  assert.throws(() => verifyVisualIndexProof('first-weave', { ...proof, exhibitionVersion: 'preview-v1' }), /canonical exhibition proof/);
  assert.throws(() => verifyVisualIndexProof('operator-atlas', proof), /identity does not match accepted entry/);
  assert.throws(() => verifyVisualIndexProof('first-weave', { ...proof, rawRgbaHash: '0000000000000000' }), /Conflicting canonical|decoded RGBA8/);
  const receipt = JSON.parse(proof.provenanceJson);
  receipt.seed += 1;
  assert.throws(() => verifyVisualIndexProof('first-weave', { ...proof, provenanceJson: JSON.stringify(receipt) }), /provenance/);
  assert.throws(() => renderVisualIndexProof('not-a-preset'), /Unknown FIELDWEAVER preset/);
});
