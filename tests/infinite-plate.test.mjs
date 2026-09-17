import assert from 'node:assert/strict';
import test from 'node:test';

import { Q16_ONE } from '../src/core/numeric.js';
import { normalizeWorldPosition } from '../src/core/coordinates.js';
import { MutationEditorSession } from '../src/editor/index.js';
import { createCanonicalExport } from '../src/export/index.js';
import {
  DEFAULT_MAX_EVALUATION_WORK,
  InfinitePlateEvaluator,
  InfinitePlateViewSession,
  PlateChunkCache,
  PlateEvaluationAbortedError,
  analyzePlateCausality,
  chunksForCrop,
  createInfinitePlateExport,
  plateRequestIdentity
} from '../src/infinite/index.js';
import { recipeHash } from '../src/recipe/index.js';

function world(xUnits, yUnits) {
  return normalizeWorldPosition({ chunkX: 0, chunkY: 0, localX: Math.round(xUnits * Q16_ONE), localY: Math.round(yUnits * Q16_ONE) });
}

function cropAt(center = world(128, 128)) {
  return { widthPx: 64, heightPx: 48, center, unitsPerPixelQ16: Q16_ONE };
}

function options(crop = cropAt()) {
  return { targetTick: 12, crop, agentCapacity: 1024, maxDepositions: 100_000, tileWidthPx: 7, tileHeightPx: 5 };
}

test('regional evaluation matches the FW-012 canonical software export oracle', () => {
  const editor = new MutationEditorSession({ agentCapacity: 1024, maxDepositions: 100_000 });
  const recipe = editor.currentRecipe();
  const request = options();
  const evaluator = new InfinitePlateEvaluator({ cacheChunks: 8 });
  const regional = evaluator.evaluate(recipe, request);
  const canonical = createCanonicalExport(recipe, request);
  assert.equal(regional.rawRgbaHash, canonical.rawRgbaHash);
  assert.deepEqual(regional.rgba, canonical.rgba);
  assert.equal(regional.sourceStateHash, canonical.stateHash);
  assert.equal(regional.sourceDepositionHash, canonical.depositionHash);
  assert.equal(regional.cacheHit, false);

  const repeated = evaluator.evaluate(recipe, { ...request, tileWidthPx: 64, tileHeightPx: 48 });
  assert.equal(repeated.cacheHit, true);
  assert.equal(repeated.rawRgbaHash, regional.rawRgbaHash);
  assert.equal(repeated.depositionHash, regional.depositionHash);
  assert.equal(repeated.resultHash, regional.resultHash);
});

test('cache capacity, eviction, navigation/request order, and tile shape are nonsemantic', () => {
  const editor = new MutationEditorSession({ agentCapacity: 1024, maxDepositions: 100_000 });
  const recipe = editor.currentRecipe();
  const near = cropAt();
  const far = cropAt({ chunkX: 37, chunkY: -19, localX: 13 * Q16_ONE, localY: 211 * Q16_ONE });
  const baselineEvaluator = new InfinitePlateEvaluator({ cacheChunks: 32 });
  const baseline = baselineEvaluator.evaluate(recipe, options(near));

  const tiny = new InfinitePlateEvaluator({ cache: new PlateChunkCache(1) });
  const farFirst = tiny.evaluate(recipe, options(far));
  assert.match(farFirst.rawRgbaHash, /^[0-9a-f]{16}$/);
  const afterFar = tiny.evaluate(recipe, { ...options(near), tileWidthPx: 13, tileHeightPx: 11 });
  tiny.clearCache();
  const afterEviction = tiny.evaluate(recipe, { ...options(near), tileWidthPx: 1, tileHeightPx: 1 });

  for (const result of [afterFar, afterEviction]) {
    assert.equal(result.sourceStateHash, baseline.sourceStateHash);
    assert.equal(result.depositionHash, baseline.depositionHash);
    assert.equal(result.rawRgbaHash, baseline.rawRgbaHash);
    assert.equal(result.resultHash, baseline.resultHash);
  }
});

test('camera navigation remains separate from recipe identity and framing preserves stable chunk coordinates', () => {
  const editor = new MutationEditorSession();
  const recipe = editor.currentRecipe();
  const before = recipeHash(recipe);
  const view = new InfinitePlateViewSession(recipe.framing.center);
  for (let index = 0; index < 40; index += 1) view.panByQ16(120 * Q16_ONE, -91 * Q16_ONE);
  const framed = view.frame(320, 180, Q16_ONE);
  assert(Math.abs(framed.center.chunkX) > 1);
  assert(Math.abs(framed.center.chunkY) > 1);
  assert.equal(recipeHash(editor.currentRecipe()), before);
  assert.equal(plateRequestIdentity(recipe, options(cropAt())), plateRequestIdentity(recipe, options(cropAt())));
  assert(chunksForCrop(framed).length > 0);
});

test('causal contract exposes bounded displacement/finite support and approves only pure global operators', () => {
  const editor = new MutationEditorSession();
  const analysis = analyzePlateCausality(editor.currentRecipe(), 25);
  assert.equal(analysis.method, 'full-replay-reference-v1');
  assert(BigInt(analysis.causalHaloQ16) > 0n);
  assert(analysis.maxStepDisplacementQ16 > 0);
  assert(analysis.depositionRadiusQ16 > 0);
  for (const operator of analysis.globalPureOperators) assert(['uniform', 'turbulence'].includes(operator));
});

test('interactive safeguards reject unbounded work and async evaluation is cancellable before semantic cache mutation', async () => {
  const editor = new MutationEditorSession({ agentCapacity: 1024, maxDepositions: 100_000 });
  const recipe = editor.currentRecipe();
  const evaluator = new InfinitePlateEvaluator({ cacheChunks: 4 });
  assert.throws(() => evaluator.evaluate(recipe, {
    ...options(),
    targetTick: Math.floor(DEFAULT_MAX_EVALUATION_WORK / 1024) + 1
  }), /exceeds safeguard/);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    evaluator.evaluateAsync(recipe, { ...options(), targetTick: 64, signal: controller.signal, tickBatch: 4 }),
    PlateEvaluationAbortedError
  );
  assert.equal(evaluator.cache.size, 0);
});

test('Infinite Plate export reuses FW-012 raster/PNG provenance and records regional identity', () => {
  const editor = new MutationEditorSession({ agentCapacity: 1024, maxDepositions: 100_000 });
  const recipe = editor.currentRecipe();
  const evaluator = new InfinitePlateEvaluator({ cacheChunks: 8 });
  const request = options();
  const evaluation = evaluator.evaluate(recipe, request);
  const packaged = createInfinitePlateExport(recipe, { ...request, evaluator, evaluation });
  const canonical = createCanonicalExport(recipe, request);
  assert.equal(packaged.version, canonical.version);
  assert.equal(packaged.rawRgbaHash, canonical.rawRgbaHash);
  assert.deepEqual(packaged.rgba, canonical.rgba);
  assert.equal(packaged.provenance.rawRgbaHash, canonical.rawRgbaHash);
  assert.equal(packaged.provenance.infinitePlate.domainHash, evaluation.domainHash);
  assert.equal(packaged.provenance.infinitePlate.regionalDepositionHash, evaluation.depositionHash);
  assert.match(packaged.provenanceJson, /fw-infinite-plate-v1/);
});
