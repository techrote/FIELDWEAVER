import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  AuthoringHistory,
  FieldLayerCollection,
  createBrushCommand
} from '../src/fields/index.js';
import { Q16_ONE } from '../src/core/numeric.js';

const fixturePath = fileURLToPath(new URL('../fixtures/fw-003-golden.json', import.meta.url));
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));

function buildScenario() {
  const fields = new FieldLayerCollection();
  const scalar = fields.createLayer({
    kind: 'scalar',
    cellsPerChunk: 256,
    blend: 'add',
    parameters: { strengthQ16: Q16_ONE }
  });
  const vector = fields.createLayer({
    kind: 'vector',
    cellsPerChunk: 64,
    blend: 'replace',
    enabled: false,
    parameters: { gainQ16: Q16_ONE / 2 }
  });

  const history = new AuthoringHistory();
  history.execute(createBrushCommand(fields, scalar.id, {
    points: [
      { chunkX: -1, chunkY: 0, cellX: 252, cellY: 3 },
      { chunkX: 0, chunkY: 0, cellX: 4, cellY: 3 }
    ]
  }, {
    operation: 'add',
    shape: 'circle',
    falloff: 'linear-ring',
    radius: 2,
    value: 7000
  }), fields);

  vector.writeCell({ chunkX: 2, chunkY: -3, cellX: 4, cellY: 5 }, [1200, -900]);
  fields.moveLayer(vector.id, 0);
  return fields;
}

test('FW-003 golden sparse field hash is stable across repeated construction and serialization', () => {
  const first = buildScenario();
  const second = buildScenario();
  assert.equal(first.hash(), fixture.fieldHash);
  assert.equal(second.hash(), fixture.fieldHash);
  assert.deepEqual(second.toCanonical(), first.toCanonical());
  assert.equal(FieldLayerCollection.fromCanonical(first.toCanonical()).hash(), fixture.fieldHash);
});
