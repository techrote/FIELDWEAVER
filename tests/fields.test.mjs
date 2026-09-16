import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FieldLayerCollection,
  SparseFieldLayer,
  AuthoringHistory,
  canonicalizeStroke,
  createBrushCommand,
  createLayerEnabledCommand,
  createLayerMoveCommand,
  fieldCellToGlobalGrid,
  globalGridToFieldCell,
  normalizeFieldCellAddress,
  worldPositionToFieldCell
} from '../src/fields/index.js';
import { Q16_ONE } from '../src/core/numeric.js';
import { CHUNK_SPAN_Q16 } from '../src/core/coordinates.js';

function makeCollection() {
  const fields = new FieldLayerCollection();
  fields.createLayer({ kind: 'scalar', cellsPerChunk: 256, blend: 'add', parameters: { strengthQ16: Q16_ONE } });
  return fields;
}

test('sparse fields allocate only on non-zero writes and prune empty chunks', () => {
  const layer = new SparseFieldLayer({ id: 1, kind: 'scalar', cellsPerChunk: 256 });
  assert.equal(layer.allocatedChunkCount, 0);
  assert.equal(layer.readCell({ chunkX: 99, chunkY: -50, cellX: 12, cellY: 7 }), 0);
  layer.writeCell({ chunkX: 99, chunkY: -50, cellX: 12, cellY: 7 }, 0);
  assert.equal(layer.allocatedChunkCount, 0);
  layer.writeCell({ chunkX: 99, chunkY: -50, cellX: 12, cellY: 7 }, 123);
  assert.equal(layer.allocatedChunkCount, 1);
  assert.equal(layer.readCell({ chunkX: 99, chunkY: -50, cellX: 12, cellY: 7 }), 123);
  layer.writeCell({ chunkX: 99, chunkY: -50, cellX: 12, cellY: 7 }, 0);
  assert.equal(layer.allocatedChunkCount, 0);
});

test('cell normalization is seam-safe for positive and negative coordinates', () => {
  assert.deepEqual(normalizeFieldCellAddress({ chunkX: 0, chunkY: 0, cellX: 256, cellY: -1 }, 256), {
    chunkX: 1, chunkY: -1, cellX: 0, cellY: 255
  });
  const global = fieldCellToGlobalGrid({ chunkX: -3, chunkY: 2, cellX: 255, cellY: 0 }, 256);
  assert.deepEqual(globalGridToFieldCell(global.x, global.y, 256), {
    chunkX: -3, chunkY: 2, cellX: 255, cellY: 0
  });
  assert.deepEqual(worldPositionToFieldCell({ chunkX: -1, chunkY: 0, localX: CHUNK_SPAN_Q16 - 1, localY: Q16_ONE }, 256), {
    chunkX: -1, chunkY: 0, cellX: 255, cellY: 1
  });
});

test('layer ordering and enabled state have explicit deterministic hash semantics', () => {
  const fields = new FieldLayerCollection();
  const a = fields.createLayer({ kind: 'scalar', parameters: { z: 2, a: 1 } });
  const b = fields.createLayer({ kind: 'vector', enabled: false, blend: 'replace' });
  const initial = fields.hash();
  fields.moveLayer(b.id, 0);
  assert.deepEqual(fields.order, [b.id, a.id]);
  assert.notEqual(fields.hash(), initial);
  const moved = fields.hash();
  fields.setEnabled(b.id, true);
  assert.notEqual(fields.hash(), moved);

  const roundTrip = FieldLayerCollection.fromCanonical(fields.toCanonical());
  assert.equal(roundTrip.hash(), fields.hash());
  assert.deepEqual(roundTrip.order, fields.order);
});

test('equivalent canonical stroke batching produces identical center sets and field hashes', () => {
  const one = makeCollection();
  const two = makeCollection();
  const a = one.getLayer(1);
  const b = two.getLayer(1);
  const direct = { points: [{ x: -3, y: 5 }, { x: 4, y: 5 }] };
  const batched = { points: [{ x: -3, y: 5 }, { x: -1, y: 5 }, { x: 2, y: 5 }, { x: 4, y: 5 }] };
  assert.deepEqual(canonicalizeStroke(a, direct), canonicalizeStroke(b, batched));

  const historyA = new AuthoringHistory();
  const historyB = new AuthoringHistory();
  const brush = { operation: 'add', shape: 'circle', falloff: 'linear-ring', radius: 2, value: 7000 };
  historyA.execute(createBrushCommand(one, 1, direct, brush), one);
  historyB.execute(createBrushCommand(two, 1, batched, brush), two);
  assert.equal(one.hash(), two.hash());
});

test('brush painting crosses chunk boundaries without seams, including negative chunks', () => {
  const fields = makeCollection();
  const history = new AuthoringHistory();
  const stroke = { points: [{ chunkX: -1, chunkY: 0, cellX: 254, cellY: 2 }, { chunkX: 0, chunkY: 0, cellX: 1, cellY: 2 }] };
  history.execute(createBrushCommand(fields, 1, stroke, { operation: 'set', radius: 0, value: 111 }), fields);
  const layer = fields.getLayer(1);
  for (const x of [254, 255]) assert.equal(layer.readCell({ chunkX: -1, chunkY: 0, cellX: x, cellY: 2 }), 111);
  for (const x of [0, 1]) assert.equal(layer.readCell({ chunkX: 0, chunkY: 0, cellX: x, cellY: 2 }), 111);
  assert.equal(layer.allocatedChunkCount, 2);
});

test('bounded authoring undo/redo restores exact field hashes and keeps timeline concerns separate', () => {
  const fields = makeCollection();
  const history = new AuthoringHistory(2);
  const initial = fields.hash();
  history.execute(createBrushCommand(fields, 1, { points: [{ x: 0, y: 0 }, { x: 3, y: 0 }] }, { operation: 'set', radius: 1, value: 1000 }), fields);
  const painted = fields.hash();
  assert.notEqual(painted, initial);
  assert.equal(history.undo(fields), true);
  assert.equal(fields.hash(), initial);
  assert.equal(history.redo(fields), true);
  assert.equal(fields.hash(), painted);

  const second = fields.createLayer({ kind: 'scalar' });
  history.execute(createLayerMoveCommand(fields, second.id, 0), fields);
  const moved = fields.hash();
  history.execute(createLayerEnabledCommand(fields, 1, false), fields);
  const disabled = fields.hash();
  assert.notEqual(disabled, moved);
  assert.equal(history.undoDepth, 2);
  assert.equal(history.undo(fields), true);
  assert.equal(fields.hash(), moved);
});

test('vector fields validate channel shape and serialize sparse data stably', () => {
  const fieldsA = new FieldLayerCollection();
  const vector = fieldsA.createLayer({ kind: 'vector', cellsPerChunk: 64, transform: { scaleXQ16: Q16_ONE * 2, scaleYQ16: Q16_ONE }, parameters: { beta: -7, alpha: 4 } });
  vector.writeCell({ chunkX: -2, chunkY: 3, cellX: 63, cellY: 0 }, [123, -456]);
  assert.deepEqual(vector.readCell({ chunkX: -2, chunkY: 3, cellX: 63, cellY: 0 }), [123, -456]);
  assert.throws(() => vector.writeCell({ chunkX: 0, chunkY: 0, cellX: 0, cellY: 0 }, [1]), /two channels/);

  const serialized = fieldsA.toCanonical();
  const fieldsB = FieldLayerCollection.fromCanonical(serialized);
  assert.deepEqual(fieldsB.toCanonical(), serialized);
  assert.equal(fieldsB.hash(), fieldsA.hash());
});
