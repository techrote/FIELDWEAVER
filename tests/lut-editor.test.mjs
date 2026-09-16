import assert from 'node:assert/strict';
import test from 'node:test';

import { LutEditorSession } from '../src/editor/index.js';

function snapshot(editor) { return editor.snapshot(0); }

test('LUT-aware editor starts with deterministic built-ins and mappings', () => {
  const first = new LutEditorSession();
  const second = new LutEditorSession();
  const a = snapshot(first);
  const b = snapshot(second);
  assert.equal(a.lutAssets.length, 2);
  assert.equal(a.lutAssets[0].size, 256);
  assert.equal(a.lutAssets[1].size, 512);
  assert.equal(a.lutMappings.length, 2);
  assert.equal(a.authoringHash, b.authoringHash);
  assert.equal(first.simulation.resultHash(), second.simulation.resultHash());
});

test('LUT entry edits, generation, mappings and JSON import/export update authoring identity deterministically', () => {
  const editor = new LutEditorSession();
  const initial = editor.authoringHash();
  editor.selectLut(1);
  editor.selectLutChannel('r');
  editor.updateSelectedLutEntry('r', 0, 12345);
  assert.notEqual(editor.authoringHash(), initial);
  assert.equal(editor.simulation.tick, 0);

  const json = editor.exportSelectedLutJson();
  const parsed = JSON.parse(json);
  assert.equal(parsed.schemaVersion, 'fw-lut-v1');
  assert.equal(parsed.channels.r[0], 12345);

  const beforeGenerate = editor.authoringHash();
  const generatedId = editor.generateLut(512, 'pulse');
  assert.equal(editor.selectedLutId, generatedId);
  assert.notEqual(editor.authoringHash(), beforeGenerate);

  const beforeMapping = editor.authoringHash();
  editor.selectMaterial(1);
  editor.selectLutChannel('logic');
  editor.assignSelectedMaterialLut({
    destination: 'depositionStrengthQ16',
    source: 'ageTicks',
    channel: 'logic',
    addressMode: 'wrap'
  });
  assert.notEqual(editor.authoringHash(), beforeMapping);
  assert.ok(snapshot(editor).lutMappings.some((mapping) => mapping.materialId === 1 && mapping.destination === 'depositionStrengthQ16'));
  assert.equal(editor.removeSelectedMaterialLutMapping('depositionStrengthQ16'), true);
  assert.equal(editor.removeSelectedMaterialLutMapping('depositionStrengthQ16'), false);

  const imported = JSON.parse(json);
  imported.id = 99;
  imported.name = 'Imported copy';
  const beforeImport = editor.authoringHash();
  assert.equal(editor.importLutJson(JSON.stringify(imported)), 99);
  assert.notEqual(editor.authoringHash(), beforeImport);
  assert.throws(() => editor.importLutJson(JSON.stringify(imported)), /already exists/);
});

test('view and simulation transport do not mutate LUT authoring identity', () => {
  const editor = new LutEditorSession();
  const identity = editor.authoringHash();
  editor.singleStep();
  editor.multiStep(4);
  editor.runTicks(3);
  assert.equal(editor.authoringHash(), identity);
  editor.resetSimulation();
  assert.equal(editor.authoringHash(), identity);
});
