import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { canonicalHash } from '../src/core/canonical.js';
import { MutationEditorSession } from '../src/editor/index.js';
import {
  MUTATION_VERSION,
  MutationRejectedError,
  mutateRecipe,
  readMutationLineage
} from '../src/mutation/index.js';
import {
  createRecipe,
  createRecipeReplay,
  parseRecipe,
  recipeHash,
  serializeRecipe
} from '../src/recipe/index.js';

function mutationParent() {
  const editor = new MutationEditorSession({ agentCapacity: 2048, maxDepositions: 100_000 });
  editor.createField('attractor');
  return editor.currentRecipe();
}

const CONFIG = Object.freeze({
  mutationSeed: 0x12345678,
  siblingIndex: 2,
  scope: 'all',
  intensity: 'medium',
  operationCount: 6
});

test('same parent, config, and mutation seed produce byte-equivalent child recipes without touching the parent', () => {
  const parent = mutationParent();
  const parentBefore = serializeRecipe(parent);
  const first = mutateRecipe(parent, CONFIG);
  const second = mutateRecipe(parent, CONFIG);

  assert.equal(serializeRecipe(first.recipe), serializeRecipe(second.recipe));
  assert.equal(first.childRecipeHash, second.childRecipeHash);
  assert.equal(first.childIdentity, second.childIdentity);
  assert.equal(serializeRecipe(parent), parentBefore, 'mutation operates on a detached recipe clone');
  assert.equal(first.parentRecipeHash, recipeHash(parent));

  const lineage = readMutationLineage(first.recipe);
  assert.equal(lineage.childIdentity, first.childIdentity);
  assert.equal(lineage.parentRecipeHash, first.parentRecipeHash);
  assert.equal(lineage.mutationSeed, CONFIG.mutationSeed);
  assert.equal(lineage.siblingIndex, CONFIG.siblingIndex);
  assert.deepEqual(lineage.operations, first.operations);
});

test('all required mutation operators are deterministic and normalized through recipe validation', () => {
  const parent = mutationParent();
  const required = new Set([
    'perturb-material-parameter',
    'adjust-field-strength-scale',
    'move-emitter',
    'swap-adjacent-fields',
    'substitute-lut',
    'derive-sibling-seed'
  ]);
  const result = mutateRecipe(parent, CONFIG);
  assert.deepEqual(new Set(result.operations.map((operation) => operation.type)), required);
  assert.equal(createRecipe(result.recipe).schemaVersion, parent.schemaVersion);
  assert.ok(result.diff.length >= 6, 'the normalized child reports exact semantic recipe differences');
});

test('scope-specific substreams create valid deterministic changes and explicit inapplicable scopes reject', () => {
  const parent = mutationParent();
  const expected = new Map([
    ['parameters', 'perturb-material-parameter'],
    ['emitters', 'move-emitter'],
    ['order', 'swap-adjacent-fields'],
    ['lut', 'substitute-lut'],
    ['seed', 'derive-sibling-seed']
  ]);
  for (const [scope, type] of expected) {
    const result = mutateRecipe(parent, { mutationSeed: 44, siblingIndex: 1, scope, intensity: 'subtle', operationCount: 1 });
    assert.equal(result.operations[0].type, type);
    assert.doesNotThrow(() => createRecipe(result.recipe));
  }
  const field = mutateRecipe(parent, { mutationSeed: 44, siblingIndex: 1, scope: 'fields', intensity: 'bold', operationCount: 2 });
  assert.ok(field.operations.every((operation) => ['adjust-field-strength-scale', 'swap-adjacent-fields'].includes(operation.type)));

  const oneLut = createRecipe({
    ...parent,
    lut: {
      schemaVersion: parent.lut.schemaVersion,
      assets: [parent.lut.assets[0]],
      mappings: parent.lut.mappings.filter((mapping) => mapping.lutId === parent.lut.assets[0].id)
    }
  });
  assert.throws(
    () => mutateRecipe(oneLut, { mutationSeed: 44, scope: 'lut', operationCount: 1 }),
    (error) => error instanceof MutationRejectedError && error.code === 'empty-mutation-scope'
  );
});

test('child save/reload preserves lineage and exact replay result', () => {
  const parent = mutationParent();
  const child = mutateRecipe(parent, CONFIG);
  const loaded = parseRecipe(serializeRecipe(child.recipe));
  assert.equal(recipeHash(loaded), child.childRecipeHash);
  assert.deepEqual(readMutationLineage(loaded), readMutationLineage(child.recipe));

  const first = createRecipeReplay(child.recipe, { capacity: 2048, maxDepositions: 100_000 });
  const second = createRecipeReplay(loaded, { capacity: 2048, maxDepositions: 100_000 });
  first.runToTick(48);
  second.runToTick(48);
  assert.equal(second.stateHash(), first.stateHash());
  assert.equal(second.depositionHash(), first.depositionHash());
  assert.equal(second.resultHash(), first.resultHash());
});

test('editor keeps immutable parent/sibling snapshots and comparisons use independent replay state', () => {
  const editor = new MutationEditorSession({ agentCapacity: 2048, maxDepositions: 100_000 });
  editor.createField('attractor');
  const parentHash = editor.recipeHash();
  const family = editor.generateVariants({ mutationSeed: 991, count: 3, scope: 'all', intensity: 'medium', operationCount: 4 });
  assert.equal(family.parentRecipeHash, parentHash);
  assert.equal(family.variants.length, 4);
  assert.equal(new Set(family.variants.map((entry) => entry.recipeHash)).size, 4);

  const comparison = editor.createVariantComparison(null, 24);
  assert.equal(comparison.length, 4);
  assert.notEqual(comparison[0].replay, comparison[1].replay);
  assert.notEqual(comparison[0].replay.simulation, comparison[1].replay.simulation);
  const untouchedTick = comparison[1].replay.simulation.tick;
  comparison[0].replay.runTicks(1);
  assert.equal(comparison[1].replay.simulation.tick, untouchedTick, 'comparison simulations do not share mutable canonical state');

  const childId = family.variants[1].id;
  const storedHash = family.variants[1].recipeHash;
  editor.restoreVariant(childId);
  editor.selectMaterial(1);
  editor.updateSelectedMaterial({ lifetimeTicks: editor.snapshot().selectedMaterial.lifetimeTicks + 1 });
  const retained = editor.variantFamilySnapshot().variants.find((entry) => entry.id === childId);
  assert.equal(retained.recipeHash, storedHash, 'editing a restored child does not rewrite its stored ancestry snapshot');
  assert.equal(editor.variantFamilySnapshot().parentRecipeHash, parentHash);
});

test('FW-011 deterministic mutation golden fixture is stable', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/fw-011-golden.json', import.meta.url), 'utf8'));
  const result = mutateRecipe(mutationParent(), CONFIG);
  const actual = {
    mutationVersion: MUTATION_VERSION,
    parentRecipeHash: result.parentRecipeHash,
    childIdentity: result.childIdentity,
    childRecipeHash: result.childRecipeHash,
    operationHash: canonicalHash(result.operations),
    diffHash: canonicalHash(result.diff),
    operationTypes: result.operations.map((operation) => operation.type)
  };
  if (fixture.childRecipeHash === 'PENDING') {
    throw new Error(`FW-011_GOLDEN=${JSON.stringify(actual)}`);
  }
  assert.deepEqual(actual, fixture);
});
