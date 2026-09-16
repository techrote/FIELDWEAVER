import assert from 'node:assert/strict';
import test from 'node:test';

import { Q16_ONE } from '../src/core/numeric.js';
import { createViewport, prepareDepositionGeometry } from '../src/renderer/index.js';

function position(x, y) {
  return { chunkX: 0, chunkY: 0, localX: x * Q16_ONE, localY: y * Q16_ONE };
}

test('renderer uses canonical LUT-resolved deposition RGBA instead of material fallback colour', () => {
  const deposition = Object.freeze({
    tick: 0,
    sequence: 0,
    agentId: 1,
    emitterId: 1,
    materialId: 1,
    materialKind: 'ink',
    primitive: 'disc',
    from: position(10, 10),
    to: position(11, 10),
    radiusQ16: Q16_ONE / 2,
    strengthQ16: Q16_ONE,
    colorRgba8: Object.freeze([12, 34, 56, 78])
  });
  const geometry = prepareDepositionGeometry(
    [deposition],
    createViewport({ widthCssPx: 800, heightCssPx: 600, zoom: 3, center: position(10, 10) })
  );
  assert.equal(geometry.pointCount, 1);
  assert.equal(geometry.points.length, 7);
  assert.ok(Math.abs(geometry.points[2] - 12 / 255) < 1e-6);
  assert.ok(Math.abs(geometry.points[3] - 34 / 255) < 1e-6);
  assert.ok(Math.abs(geometry.points[4] - 56 / 255) < 1e-6);
  assert.ok(Math.abs(geometry.points[5] - 78 / 255) < 1e-6);
});

test('renderer rejects malformed canonical LUT colour records explicitly', () => {
  const deposition = {
    tick: 0,
    sequence: 0,
    agentId: 1,
    emitterId: 1,
    materialId: 1,
    materialKind: 'ink',
    primitive: 'disc',
    from: position(10, 10),
    to: position(11, 10),
    radiusQ16: Q16_ONE / 2,
    strengthQ16: Q16_ONE,
    colorRgba8: [0, 0, 0, 256]
  };
  assert.throws(
    () => prepareDepositionGeometry([deposition], createViewport({ center: position(10, 10) })),
    /integer in \[0, 255\]/
  );
});
