import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILTIN_PRESETS } from '../src/presets/index.js';
import { recipeHash } from '../src/recipe/index.js';
import { exhibitionEntries } from '../src/ui/exhibition-catalog.js';
import { renderVisualIndexProof } from '../src/ui/exhibition-visual-index-model.js';
import { studyNextId, studyArtworkLabel, studyPixelCursor } from '../src/ui/exhibition-study.js';

test('canonical study cycles the accepted catalog in both directions without introducing other works', () => {
  const ids = exhibitionEntries().map((entry) => entry.id);
  assert.equal(ids.length, 4);
  assert.equal(studyNextId(ids, ids[0], -1), ids[3]);
  assert.equal(studyNextId(ids, ids[3], 1), ids[0]);
  assert.equal(studyNextId(ids, ids[1], 6), ids[3]);
  assert.throws(() => studyNextId(ids, 'unmerged-artwork', 1), /Unknown accepted/);
  assert.throws(() => studyNextId(ids, ids[0], 1.5), /Invalid accepted/);
  assert.throws(() => studyNextId([ids[0], ids[0]], ids[0], 1), /Invalid accepted/);
});

test('study shows identities of truly generated canonical CPU images without recipe mutation', () => {
  const before = BUILTIN_PRESETS.map((preset) => recipeHash(preset.recipe));
  for (const entry of exhibitionEntries()) {
    const proof = renderVisualIndexProof(entry.id);
    const label = studyArtworkLabel(entry, proof.rawRgbaHash);
    assert.equal(label.id, entry.id);
    assert.match(label.alt, /Canonical CPU software-raster/);
    assert(label.details.includes('Seed ' + entry.seed));
    assert(label.details.includes('tick ' + entry.targetTick));
    assert(label.details.includes('recipe ' + entry.recipeHash));
    assert(label.details.includes('decoded RGBA8 ' + proof.rawRgbaHash));
    assert(label.details.includes('crop ' + entry.exportCrop.widthPx + '×' + entry.exportCrop.heightPx));
    assert.equal(Object.isFrozen(label), true);
    assert.throws(() => studyArtworkLabel(entry, 'proxy-image'), /verified accepted CPU/);
  }
  assert.deepEqual(BUILTIN_PRESETS.map((preset) => recipeHash(preset.recipe)), before);
});


test('keyboard pixel cursor moves in canonical source coordinates and clamps at crop boundaries', () => {
  assert.deepEqual(studyPixelCursor(96, 64, 48, 32, 'ArrowRight'), { x: 49, y: 32 });
  assert.deepEqual(studyPixelCursor(96, 64, 49, 32, 'ArrowDown', true), { x: 49, y: 42 });
  assert.deepEqual(studyPixelCursor(96, 64, 0, 0, 'ArrowLeft', true), { x: 0, y: 0 });
  assert.deepEqual(studyPixelCursor(96, 64, 95, 63, 'ArrowDown', true), { x: 95, y: 63 });
  assert.deepEqual(studyPixelCursor(1, 1, 0, 0, 'ArrowRight'), { x: 0, y: 0 });
  assert.equal(studyPixelCursor(96, 64, 48, 32, 'Enter'), null);
  assert.equal(Object.isFrozen(studyPixelCursor(96, 64, 1, 1, 'ArrowUp')), true);
  for (const args of [[0, 64, 0, 0, 'ArrowUp'], [96, 64, -1, 0, 'ArrowUp'],
    [96, 64, 96, 0, 'ArrowUp'], [96, 64, 1.2, 0, 'ArrowUp'],
    [96, 64, 0, 0, 'ArrowUp', 'yes']]) {
    assert.throws(() => studyPixelCursor(...args), /Invalid canonical pixel cursor geometry/);
  }
});
