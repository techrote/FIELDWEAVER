import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { RecipeEditorSession } from '../src/editor/index.js';
import {
  COMMAND_SCHEMA_VERSION,
  RECIPE_SCHEMA_VERSION,
  createRecipeReplay,
  parseRecipe,
  recipeHash,
  serializeRecipe
} from '../src/recipe/index.js';

function makeCommandTimeline(editor) {
  const baseColor = editor.currentRecipe().lut.mappings.find((mapping) => mapping.materialId === 1 && mapping.destination === 'color');
  return [
    { id: 30, tick: 4, type: 'set-emitter-rate', emitterId: 1, rate: 1 },
    { id: 10, tick: 4, type: 'set-material-parameter', materialId: 1, parameter: 'steeringNumerator', value: 2 },
    { id: 20, tick: 4, type: 'set-field-enabled', fieldId: 2, enabled: false },
    { id: 40, tick: 7, type: 'release-burst', emitterId: 1, count: 5 },
    { id: 50, tick: 9, type: 'set-lut-mapping', materialId: 1, destination: 'color', mapping: { ...baseColor, lutId: 2 } },
    { id: 60, tick: 12, type: 'set-simulation-frozen', frozen: true },
    { id: 70, tick: 15, type: 'set-simulation-frozen', frozen: false }
  ];
}

test('nontrivial recipe round-trips with stable normalized identity and replay hashes', () => {
  const original = new RecipeEditorSession({ agentCapacity: 2048, maxDepositions: 100_000 });
  original.createField('attractor');
  original.selectField(3);
  original.paintStroke([
    { chunkX: 0, chunkY: 0, localX: 64 << 16, localY: 96 << 16 },
    { chunkX: 0, chunkY: 0, localX: 72 << 16, localY: 104 << 16 }
  ]);
  original.setCommandTimeline(makeCommandTimeline(original));

  const beforeHash = original.recipeHash();
  const text = original.exportRecipeJson();
  const parsed = parseRecipe(text);
  assert.equal(parsed.schemaVersion, RECIPE_SCHEMA_VERSION);
  assert.equal(parsed.fields.layers.length, 3);
  assert.equal(parsed.materials.length, 4);
  assert.ok(parsed.emitters.length >= 2);
  assert.ok(parsed.lut.assets.length >= 2);
  assert.ok(parsed.lut.mappings.length >= 2);
  assert.equal(parsed.commands.length, 7);
  assert.equal(recipeHash(parsed), beforeHash);
  assert.equal(serializeRecipe(parsed), text);

  const loaded = new RecipeEditorSession({ agentCapacity: 2048, maxDepositions: 100_000 });
  loaded.importRecipeJson(text);
  assert.equal(loaded.recipeHash(), beforeHash);
  assert.equal(loaded.snapshot().history.undoDepth, 0, 'authoring undo history is not serialized into canonical command history');
  assert.equal(loaded.snapshot().commandCount, 7);

  original.resetSimulation();
  loaded.resetSimulation();
  original.runTicks(40);
  loaded.runTicks(40);
  assert.equal(loaded.simulation.stateHash(), original.simulation.stateHash());
  assert.equal(loaded.simulation.depositionHash(), original.simulation.depositionHash());
  assert.equal(loaded.simulation.resultHash(), original.simulation.resultHash());
});

test('recipe normalization is property-order independent and same-tick commands use tick then numeric ID', () => {
  const editor = new RecipeEditorSession({ agentCapacity: 512, maxDepositions: 20_000 });
  editor.setCommandTimeline([
    { version: COMMAND_SCHEMA_VERSION, id: 20, tick: 0, type: 'set-emitter-rate', emitterId: 1, rate: 0 },
    { type: 'set-emitter-rate', rate: 4, emitterId: 1, tick: 0, id: 10 }
  ]);
  const recipe = editor.currentRecipe();
  assert.deepEqual(recipe.commands.map((command) => command.id), [10, 20]);

  const reordered = {
    lineage: recipe.lineage,
    commands: recipe.commands.map((command) => Object.fromEntries(Object.entries(command).reverse())),
    lut: recipe.lut,
    emitters: recipe.emitters,
    materials: recipe.materials,
    fields: recipe.fields,
    framing: recipe.framing,
    seed: recipe.seed,
    engineVersion: recipe.engineVersion,
    schemaVersion: recipe.schemaVersion
  };
  assert.equal(recipeHash(reordered), recipeHash(recipe));

  const replay = createRecipeReplay(recipe, { capacity: 512, maxDepositions: 20_000 });
  replay.runTicks(1);
  assert.deepEqual(replay.appliedCommandIds, [10, 20]);
  assert.equal(replay.simulation.emitters.find((emitter) => emitter.id === 1).rate, 0);
});

test('malformed imports fail transactionally without partially mutating the editor', () => {
  const editor = new RecipeEditorSession();
  const beforeHash = editor.recipeHash();
  const beforeRecipe = editor.exportRecipeJson();
  const malformed = JSON.parse(beforeRecipe);
  malformed.emitters[0].materialId = 0xffffffff;
  assert.throws(() => editor.importRecipeJson(JSON.stringify(malformed)), /unknown material/i);
  assert.equal(editor.recipeHash(), beforeHash);
  assert.equal(editor.exportRecipeJson(), beforeRecipe);
  assert.throws(() => editor.importRecipeJson('{oops'), /Invalid recipe JSON/);
  assert.equal(editor.recipeHash(), beforeHash);
});

test('unknown incompatible recipe versions are rejected unless an explicit migration is registered', async () => {
  const text = await readFile(new URL('../fixtures/fw-009-incompatible-recipe.json', import.meta.url), 'utf8');
  assert.throws(() => parseRecipe(text), /Unsupported recipe schema version: fw-recipe-v0; no explicit migration is registered/);
});

test('freeze/resume and deterministic release commands are replayed at exact ticks', () => {
  const editor = new RecipeEditorSession({ agentCapacity: 1024, maxDepositions: 50_000 });
  editor.setCommandTimeline([
    { id: 1, tick: 2, type: 'release-burst', emitterId: 1, count: 6 },
    { id: 2, tick: 3, type: 'set-simulation-frozen', frozen: true },
    { id: 3, tick: 6, type: 'set-simulation-frozen', frozen: false }
  ]);
  const replay = createRecipeReplay(editor.currentRecipe(), { capacity: 1024, maxDepositions: 50_000 });
  replay.runToTick(3);
  const atFreeze = replay.simulation.depositionHash();
  replay.runToTick(6);
  assert.equal(replay.simulation.depositionHash(), atFreeze, 'frozen ticks do not advance agents or emitters');
  replay.runToTick(7);
  assert.notEqual(replay.simulation.depositionHash(), atFreeze, 'resume applies before the tick-6 transition');
  assert.deepEqual(replay.appliedCommandIds, [1, 2, 3]);
});
