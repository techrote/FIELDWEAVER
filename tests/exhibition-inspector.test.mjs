import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILTIN_PRESETS } from '../src/presets/index.js';
import { recipeHash } from '../src/recipe/index.js';
import { renderExhibitionProof } from '../src/ui/exhibition-catalog.js';
import { inspectionSlots } from '../src/ui/exhibition-inspector.js';

test('inspection uses two independent canonical proofs without changing their identities or sources', () => {
  const original = BUILTIN_PRESETS.map((preset) => recipeHash(preset.recipe));
  const a = renderExhibitionProof('first-weave');
  const b = renderExhibitionProof('operator-atlas');
  const pair = inspectionSlots(a, b);
  assert(Object.isFrozen(pair));
  assert(Object.isFrozen(pair.a));
  assert(Object.isFrozen(pair.b));
  assert.equal(pair.a.rawRgbaHash, '8d83d52e732a5825');
  assert.equal(pair.a.rawRgbaHash, a.rawRgbaHash);
  assert.equal(pair.b.rawRgbaHash, b.rawRgbaHash);
  assert.notEqual(pair.a.rawRgbaHash, pair.b.rawRgbaHash);
  assert.match(pair.a.details, new RegExp(a.recipeHash));
  assert.match(pair.b.details, new RegExp(b.recipeHash));
  assert.match(pair.a.details, /raw RGBA8/);
  assert.equal(pair.a.widthPx, a.crop.widthPx);
  assert.deepEqual(BUILTIN_PRESETS.map((preset) => recipeHash(preset.recipe)), original);
});

test('inspector has a one-up state and refuses fabricated/stale accepted proof metadata', () => {
  const a = renderExhibitionProof('first-weave');
  assert.equal(inspectionSlots(null, null).a, null);
  assert.equal(inspectionSlots(null, a).a.id, 'first-weave');
  assert.equal(inspectionSlots(null, a).b, null);
  assert.equal(inspectionSlots(a, null).a.id, 'first-weave');
  assert.equal(inspectionSlots(a, null).b, null);
  assert.throws(() => inspectionSlots({ ...a, targetTick: a.targetTick + 1 }, null), /does not match/);
  assert.throws(() => inspectionSlots(null, { ...a, recipeHash: '0000000000000000' }), /does not match/);
  assert.throws(() => inspectionSlots({ ...a, exhibitionVersion: 'noncanonical-proxy' }, null), /canonical exhibition proof/);
});
