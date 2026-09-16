import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CanonicalSoATable, canonicalHash, canonicalStringify } from '../src/core/index.js';

test('canonical serialization sorts object keys and preserves array order', () => {
  assert.equal(canonicalStringify({ z: 1, a: [3, 2, 1] }), '{"a":[3,2,1],"z":1}');
  assert.equal(canonicalHash({ a: 1, b: 2 }), canonicalHash({ b: 2, a: 1 }));
  assert.throws(() => canonicalStringify({ invalid: 0.5 }), /safe integer/);
});

test('SoA storage uses monotonic stable IDs and canonical ascending iteration', () => {
  const table = new CanonicalSoATable({ velocity: 'i32', flags: 'u32' }, 4);
  const first = table.create({ velocity: -2, flags: 7 });
  const second = table.create({ velocity: 9, flags: 1 });
  assert.equal(first, 1);
  assert.equal(second, 2);

  const visited = [];
  table.forEachOrdered((id) => visited.push(id));
  assert.deepEqual(visited, [1, 2]);
  assert.equal(table.get(1, 'velocity'), -2);

  table.set(2, 'velocity', 11);
  assert.equal(table.get(2, 'velocity'), 11);

  const restored = CanonicalSoATable.fromSnapshot(table.snapshot());
  assert.deepEqual(Array.from(restored.ids()), [1, 2]);
  assert.equal(restored.get(2, 'velocity'), 11);
});
