import assert from 'node:assert/strict';
import test from 'node:test';

import { LutEditorSession } from '../src/editor/index.js';

test('fresh FW-008 editor demo actively exercises both colour and behaviour LUT roles', () => {
  const editor = new LutEditorSession();
  const materialIds = new Set(editor.simulation.emitters.map((emitter) => emitter.materialId));
  assert.ok(materialIds.has(1), 'Ink emitter must be present for the built-in colour LUT demo.');
  assert.ok(materialIds.has(3), 'Dust emitter must be present for the built-in steering LUT demo.');
  assert.ok(editor.lutRegistry().mapping(1, 'color'));
  assert.ok(editor.lutRegistry().mapping(3, 'steeringMultiplierQ16'));

  editor.runTicks(4);
  const ink = editor.simulation.depositions.find((record) => record.materialId === 1);
  const dust = editor.simulation.depositions.find((record) => record.materialId === 3);
  assert.ok(ink?.colorRgba8, 'Ink demo deposition must carry LUT-resolved canonical colour.');
  assert.ok(dust, 'Dust behavior-mapped emitter must produce canonical depositions.');
});
