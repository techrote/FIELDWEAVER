import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createCanonicalExport } from '../src/export/index.js';
import { BUILTIN_PRESETS, PRESET_CATALOG_VERSION, getBuiltinPreset } from '../src/presets/index.js';
import { createRecipeReplay, recipeHash } from '../src/recipe/index.js';

const REQUIRED_COVERAGE = Object.freeze([
  'uniform', 'vortex', 'attractor', 'turbulence', 'direction-quantizer',
  'ink', 'filament', 'dust', 'shard', 'mixed-field-stack',
  'lut-color', 'lut-behaviour', 'timeline', 'lineage', 'mutation', 'infinite-plate', 'canonical-export'
]);

async function goldenFixture() {
  return JSON.parse(await readFile(new URL('../fixtures/fw-014-presets.json', import.meta.url), 'utf8'));
}

function evaluatePreset(preset) {
  const replay = createRecipeReplay(preset.recipe, { capacity: 4096, maxDepositions: 250_000 });
  replay.runToTick(preset.targetTick);
  const exported = createCanonicalExport(preset.recipe, {
    targetTick: preset.targetTick,
    crop: preset.exportCrop,
    agentCapacity: 4096,
    maxDepositions: 250_000,
    tileWidthPx: 31,
    tileHeightPx: 23
  });
  return Object.freeze({
    recipeHash: recipeHash(preset.recipe),
    stateHash: replay.stateHash(),
    depositionHash: replay.depositionHash(),
    resultHash: replay.resultHash(),
    rawRgbaHash: exported.rawRgbaHash
  });
}

test('release preset catalog covers the shipped creative feature set with unique stable IDs', () => {
  assert.equal(PRESET_CATALOG_VERSION, 'fw-presets-v1');
  assert.equal(BUILTIN_PRESETS.length, 4);
  assert.equal(new Set(BUILTIN_PRESETS.map((preset) => preset.id)).size, BUILTIN_PRESETS.length);
  const coverage = new Set(BUILTIN_PRESETS.flatMap((preset) => preset.coverage));
  for (const required of REQUIRED_COVERAGE) assert(coverage.has(required), `missing preset coverage: ${required}`);
  for (const preset of BUILTIN_PRESETS) {
    assert.equal(getBuiltinPreset(preset.id), preset);
    assert.equal(preset.recipeHash, recipeHash(preset.recipe));
    assert(preset.targetTick > 0);
    assert(preset.exportCrop.widthPx > 0 && preset.exportCrop.heightPx > 0);
  }
  assert.throws(() => getBuiltinPreset('missing-preset'), /Unknown FIELDWEAVER preset/);
});

test('Infinite Lineage preset preserves explicit far-world framing and mutation provenance', () => {
  const preset = getBuiltinPreset('infinite-lineage');
  assert.equal(preset.recipe.framing.center.chunkX, 12);
  assert.equal(preset.recipe.framing.center.chunkY, -7);
  assert.notEqual(preset.recipe.lineage, null);
  assert.match(preset.recipe.lineage.parentRecipeHash, /^[0-9a-f]{16}$/);
  assert(preset.recipe.lineage.operations.length >= 2, 'lineage includes identity plus deterministic mutation operation');
});

test('all shipped presets reproduce checked-in recipe, canonical-state, deposition, result, and raw-pixel identities', async () => {
  const fixture = await goldenFixture();
  assert.equal(fixture.version, 'fw-presets-golden-v1');
  const actual = {};
  for (const preset of BUILTIN_PRESETS) actual[preset.id] = evaluatePreset(preset);
  console.log(`FW-014 preset golden candidates: ${JSON.stringify(actual)}`);
  assert.deepEqual(Object.keys(fixture.presets).sort(), BUILTIN_PRESETS.map((preset) => preset.id).sort());
  for (const preset of BUILTIN_PRESETS) assert.deepEqual(actual[preset.id], fixture.presets[preset.id], preset.id);
});
