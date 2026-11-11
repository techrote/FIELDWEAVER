import assert from 'node:assert/strict';
import test from 'node:test';
import { getBuiltinPreset, BUILTIN_PRESETS } from '../src/presets/index.js';
import { parseRecipe, recipeHash, serializeRecipe } from '../src/recipe/index.js';
import { buildAcceptedRecipeHandoff } from '../src/ui/exhibition-recipe-handoff.js';

test('every accepted exhibition recipe downloads as an importable exact-normalized file', () => {
  const baseline = BUILTIN_PRESETS.map((p) => recipeHash(p.recipe));
  for (const preset of BUILTIN_PRESETS) {
    const handoff = buildAcceptedRecipeHandoff(preset.id);
    const imported = parseRecipe(handoff.json);
    assert.equal(handoff.filename, 'fieldweaver-' + preset.id + '-' + preset.recipeHash + '.fwrecipe.json');
    assert.equal(handoff.json, serializeRecipe(preset.recipe));
    assert.equal(handoff.json, serializeRecipe(imported), 'repeat export must be byte identical');
    assert.equal(recipeHash(imported), preset.recipeHash);
    assert.equal(handoff.recipeHash, preset.recipeHash);
    assert.equal(handoff.seed, preset.recipe.seed);
    assert.equal(handoff.targetTick, preset.targetTick);
    assert.deepEqual(handoff.crop, preset.exportCrop);
    assert.equal(Object.isFrozen(handoff), true);
    assert.equal(Object.isFrozen(handoff.crop), true);
    assert.equal(Object.isFrozen(handoff.crop.center), true);
    assert.equal(handoff.json.endsWith('\n'), true);
    assert.equal(getBuiltinPreset(preset.id).recipeHash, preset.recipeHash);
  }
  assert.deepEqual(BUILTIN_PRESETS.map((p) => recipeHash(p.recipe)), baseline);
});

test('gallery handoff rejects unaccepted works and does not accept proxy receipt payloads', () => {
  for (const id of ['pending-original-09', 'variant-09', '', null, '__proto__']) {
    assert.throws(() => buildAcceptedRecipeHandoff(id), /Unknown FIELDWEAVER preset/);
  }
  const selected = buildAcceptedRecipeHandoff('first-weave');
  assert.equal(typeof JSON.parse(selected.json).schemaVersion, 'string');
  assert.equal(Object.hasOwn(JSON.parse(selected.json), 'rawRgbaHash'), false,
    'a loadable recipe must not masquerade as an image or provenance receipt');
  assert.equal(Object.hasOwn(JSON.parse(selected.json), 'recipe'), false,
    'the editor imports the top-level normalized recipe directly');
});
