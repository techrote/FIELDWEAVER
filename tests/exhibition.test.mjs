import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { decodePngRgba } from '../src/export/index.js';
import { BUILTIN_PRESETS } from '../src/presets/index.js';
import { recipeHash } from '../src/recipe/index.js';
import { EXHIBITION_VERSION, exhibitionEntries, nextExhibitionId, renderExhibitionProof } from '../src/ui/exhibition-catalog.js';

test('exhibition navigation exposes the accepted immutable recipes and wraps both directions', () => {
  const entries = exhibitionEntries();
  assert.equal(EXHIBITION_VERSION, 'fw-exhibition-v1');
  assert.deepEqual(entries.map((entry) => entry.id), BUILTIN_PRESETS.map((preset) => preset.id));
  assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
  for (const [index, entry] of entries.entries()) {
    const source = BUILTIN_PRESETS[index];
    assert.equal(entry.recipeHash, recipeHash(source.recipe));
    assert.equal(entry.seed, source.recipe.seed >>> 0);
    assert.equal(entry.targetTick, source.targetTick);
    assert.deepEqual(entry.exportCrop, source.exportCrop);
    assert.equal(entry.lineage, source.recipe.lineage);
    assert(Object.isFrozen(entry));
  }
  assert.equal(nextExhibitionId(entries[0].id, -1), entries.at(-1).id);
  assert.equal(nextExhibitionId(entries.at(-1).id, 1), entries[0].id);
  assert.equal(nextExhibitionId(entries[0].id, entries.length), entries[0].id);
  assert.throws(() => nextExhibitionId('does-not-exist', 1), /Unknown exhibition selection/);
  assert.throws(() => nextExhibitionId(entries[0].id, 0.25), /integer/);
});

test('exhibition proof is decoded canonical RGBA8 at the exact golden tick/crop and does not mutate recipe', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/fw-014-presets.json', import.meta.url), 'utf8'));
  const entry = exhibitionEntries()[0];
  const before = recipeHash(BUILTIN_PRESETS[0].recipe);
  const proof = renderExhibitionProof(entry.id);
  const golden = fixture.presets[entry.id];
  assert.equal(proof.version, 'fw-canonical-export-v1');
  assert.equal(proof.presetId, entry.id);
  assert.equal(proof.exhibitionVersion, EXHIBITION_VERSION);
  assert.equal(proof.recipeHash, before);
  assert.equal(proof.recipeHash, golden.recipeHash);
  assert.equal(proof.targetTick, entry.targetTick);
  assert.deepEqual(proof.crop, entry.exportCrop);
  assert.equal(proof.rawRgbaHash, golden.rawRgbaHash);
  assert.equal(proof.stateHash, golden.stateHash);
  assert.equal(proof.depositionHash, golden.depositionHash);
  assert.equal(proof.resultHash, golden.resultHash);
  const decoded = decodePngRgba(proof.png);
  assert.deepEqual(decoded.rgba, proof.rgba);
  const provenance = JSON.parse(proof.provenanceJson);
  assert.equal(provenance.rawRgbaHash, proof.rawRgbaHash);
  assert.equal(provenance.recipeHash, before);
  assert.equal(provenance.targetTick, entry.targetTick);
  assert.deepEqual(provenance.crop, entry.exportCrop);
  assert.equal(provenance.seed, entry.seed);
  assert.equal(recipeHash(BUILTIN_PRESETS[0].recipe), before, 'gallery must not touch the accepted recipe');
  assert.throws(() => renderExhibitionProof('missing'), /Unknown FIELDWEAVER preset/);
});
