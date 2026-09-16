import test from 'node:test';
import assert from 'node:assert/strict';

import { Q16_ONE } from '../src/core/numeric.js';
import { EditorSession, worldPositionFromUnits } from '../src/editor/index.js';
import { sampleFieldStack } from '../src/fields/index.js';

test('editor session starts as a usable deterministic instrument model', () => {
  const editor = new EditorSession({ rootSeed: 1234 });
  const state = editor.snapshot();
  assert.equal(state.rootSeed, 1234);
  assert.equal(state.running, false);
  assert.equal(state.tick, 0);
  assert.equal(state.fields.length, 2);
  assert.equal(state.emitters.length, 1);
  assert.deepEqual(state.materials.map((material) => material.kind), ['ink', 'filament', 'dust', 'shard']);
  assert.equal(typeof state.authoringHash, 'string');
  assert.ok(state.authoringHash.length > 0);
});

test('painted vector field cells affect canonical sampling and round-trip through authoring undo/redo', () => {
  const editor = new EditorSession({ rootSeed: 77 });
  const position = worldPositionFromUnits(110, 96);
  const beforeHash = editor.authoringHash();
  const beforeSample = sampleFieldStack(editor.fieldCollection, position);

  editor.setBrush({ radius: 0, valueXQ16: Q16_ONE / 2, valueYQ16: Q16_ONE / 4, falloff: 'flat' });
  assert.equal(editor.paintStroke([position], 'set'), true);
  const paintedHash = editor.authoringHash();
  const paintedSample = sampleFieldStack(editor.fieldCollection, position);
  assert.notEqual(paintedHash, beforeHash);
  assert.equal(paintedSample.xQ16, beforeSample.xQ16 + Q16_ONE / 2);
  assert.equal(paintedSample.yQ16, beforeSample.yQ16 + Q16_ONE / 4);

  assert.equal(editor.undoAuthoring(), true);
  assert.equal(editor.authoringHash(), beforeHash);
  assert.deepEqual(sampleFieldStack(editor.fieldCollection, position), beforeSample);
  assert.equal(editor.redoAuthoring(), true);
  assert.equal(editor.authoringHash(), paintedHash);
  assert.deepEqual(sampleFieldStack(editor.fieldCollection, position), paintedSample);
});

test('field enable/reorder commands are visible and deterministic under undo/redo', () => {
  const editor = new EditorSession();
  const initialOrder = [...editor.fieldCollection.order];
  const selected = editor.selectedFieldId;
  editor.setFieldEnabled(selected, false);
  assert.equal(editor.fieldCollection.getLayer(selected).enabled, false);
  assert.equal(editor.undoAuthoring(), true);
  assert.equal(editor.fieldCollection.getLayer(selected).enabled, true);
  assert.equal(editor.redoAuthoring(), true);
  assert.equal(editor.fieldCollection.getLayer(selected).enabled, false);

  editor.setFieldEnabled(selected, true);
  editor.moveField(selected, 1);
  assert.deepEqual(editor.fieldCollection.order, [initialOrder[1], initialOrder[0]]);
  assert.equal(editor.undoAuthoring(), true);
  assert.deepEqual(editor.fieldCollection.order, initialOrder);
});

test('same authored seed and explicit tick count reproduce identical simulation results independent of UI speed', () => {
  const editor = new EditorSession({ rootSeed: 0x12345678 });
  editor.setSpeedMultiplier(8);
  editor.runTicks(40);
  const fastScheduledIdentity = editor.simulation.resultHash();

  editor.resetSimulation();
  editor.setSpeedMultiplier(0.25);
  editor.runTicks(40);
  assert.equal(editor.simulation.resultHash(), fastScheduledIdentity);
  assert.equal(editor.simulation.tick, 40);

  editor.resetSimulation();
  editor.singleStep();
  assert.equal(editor.simulation.tick, 1);
  editor.multiStep(7);
  assert.equal(editor.simulation.tick, 8);
  editor.resetSimulation();
  assert.equal(editor.simulation.tick, 0);
});

test('emitter placement, material assignment, and material editing validate through the canonical simulation', () => {
  const editor = new EditorSession({ rootSeed: 5 });
  const secondMaterial = editor.snapshot().materials[1];
  editor.selectMaterial(secondMaterial.id);
  const emitterId = editor.addEmitter(worldPositionFromUnits(80, 80), secondMaterial.id);
  editor.selectEmitter(emitterId);
  editor.updateSelectedEmitter({ rate: 3, materialId: secondMaterial.id });
  editor.updateSelectedMaterial({ lifetimeTicks: 120, depositEvery: 2, steeringNumerator: 2 });

  const state = editor.snapshot();
  assert.equal(state.emitters.length, 2);
  assert.equal(state.selectedEmitter.materialId, secondMaterial.id);
  assert.equal(state.selectedEmitter.rate, 3);
  assert.equal(state.selectedMaterial.lifetimeTicks, 120);
  editor.runTicks(12);
  assert.ok(editor.simulation.totalSpawned > 0);
  assert.ok(editor.simulation.depositions.length > 0);
});

test('recorded root-seed changes become part of authoring identity and deterministic reset', () => {
  const editor = new EditorSession({ rootSeed: 1 });
  const before = editor.authoringHash();
  editor.setRootSeed(0xfeedbeef);
  assert.equal(editor.rootSeed, 0xfeedbeef);
  assert.notEqual(editor.authoringHash(), before);
  editor.runTicks(20);
  const expected = editor.simulation.resultHash();
  editor.resetSimulation();
  editor.runTicks(20);
  assert.equal(editor.simulation.resultHash(), expected);
});
