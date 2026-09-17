import { canonicalHash, canonicalStringify } from '../core/canonical.js';
import { CHUNK_SPAN_Q16, normalizeWorldPosition, translateWorldPosition } from '../core/coordinates.js';
import { INT32_MAX, assertInt32 } from '../core/numeric.js';
import { FIELD_OPERATOR_REGISTRY } from '../fields/operators.js';
import { createRecipe, createRecipeReplay, recipeHash } from '../recipe/index.js';
import { MAX_MATERIAL_INTERACTION_RADIUS_Q16, MAX_STEP_DISPLACEMENT_Q16, SIMULATION_VERSION } from '../sim/index.js';
import {
  DEFAULT_EXPORT_BACKGROUND_RGBA8,
  DEFAULT_TILE_SIZE,
  MAX_ASSEMBLED_PIXELS,
  normalizeExportCrop,
  rasterizeDepositionsTiled,
  rawRgbaHash
} from '../export/raster.js';

export const INFINITE_PLATE_VERSION = 'fw-infinite-plate-v1';
export const INFINITE_PLATE_METHOD = 'full-replay-reference-v1';
export const DEFAULT_PLATE_CACHE_CHUNKS = 32;
export const MAX_PLATE_CACHE_CHUNKS = 4096;
export const MAX_PLATE_REQUEST_CHUNKS = 4096;
export const DEFAULT_MAX_EVALUATION_WORK = 250_000_000;
export const DEFAULT_ASYNC_TICK_BATCH = 64;

const BI_CHUNK_SPAN_2 = 2n * BigInt(CHUNK_SPAN_Q16);
const UINT32_MAX = 0xffffffff;

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}

function assertPositiveInteger(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new RangeError(`${label} must be an integer in [1, ${max}].`);
  return value;
}

function assertNonnegativeInteger(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`${label} must be an integer in [0, ${max}].`);
  return value;
}

function floorDiv(numerator, denominator) {
  if (denominator <= 0n) throw new RangeError('floorDiv denominator must be positive.');
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder < 0n) quotient -= 1n;
  return quotient;
}

function absoluteAxis2(position, axis) {
  const normalized = normalizeWorldPosition(position);
  const chunk = axis === 'x' ? normalized.chunkX : normalized.chunkY;
  const local = axis === 'x' ? normalized.localX : normalized.localY;
  return 2n * (BigInt(chunk) * BigInt(CHUNK_SPAN_Q16) + BigInt(local));
}

function chunkKey(chunkX, chunkY) {
  return `${chunkX},${chunkY}`;
}

function normalizeBackground(value) {
  const source = value ?? DEFAULT_EXPORT_BACKGROUND_RGBA8;
  if (!Array.isArray(source) || source.length !== 4) throw new TypeError('backgroundRgba8 must be a four-entry array.');
  const result = source.map((channel, index) => {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) throw new RangeError(`backgroundRgba8[${index}] must be in [0, 255].`);
    return channel;
  });
  if (result[3] !== 255) throw new RangeError('Infinite Plate canonical background alpha must be 255.');
  return Object.freeze(result);
}

function cropChunkRange(crop) {
  const centerX2 = absoluteAxis2(crop.center, 'x');
  const centerY2 = absoluteAxis2(crop.center, 'y');
  const units = BigInt(crop.unitsPerPixelQ16);
  const minX2 = centerX2 + BigInt(1 - crop.widthPx) * units;
  const maxX2 = centerX2 + BigInt(crop.widthPx - 1) * units;
  const minY2 = centerY2 + BigInt(1 - crop.heightPx) * units;
  const maxY2 = centerY2 + BigInt(crop.heightPx - 1) * units;
  return Object.freeze({
    minChunkX: Number(floorDiv(minX2, BI_CHUNK_SPAN_2)),
    maxChunkX: Number(floorDiv(maxX2, BI_CHUNK_SPAN_2)),
    minChunkY: Number(floorDiv(minY2, BI_CHUNK_SPAN_2)),
    maxChunkY: Number(floorDiv(maxY2, BI_CHUNK_SPAN_2))
  });
}

export function chunksForCrop(cropInput, maxChunks = MAX_PLATE_REQUEST_CHUNKS) {
  const crop = normalizeExportCrop(cropInput);
  assertPositiveInteger(maxChunks, 'maxChunks', MAX_PLATE_REQUEST_CHUNKS);
  const range = cropChunkRange(crop);
  const width = BigInt(range.maxChunkX) - BigInt(range.minChunkX) + 1n;
  const height = BigInt(range.maxChunkY) - BigInt(range.minChunkY) + 1n;
  const count = width * height;
  if (count > BigInt(maxChunks)) {
    throw new RangeError(`Infinite Plate request spans ${count} chunks; limit is ${maxChunks}. Increase units/pixel or reduce crop dimensions.`);
  }
  const chunks = [];
  for (let chunkY = range.minChunkY; chunkY <= range.maxChunkY; chunkY += 1) {
    for (let chunkX = range.minChunkX; chunkX <= range.maxChunkX; chunkX += 1) {
      chunks.push(Object.freeze({ chunkX, chunkY }));
    }
  }
  return Object.freeze(chunks);
}

function depositionChunkRange(record) {
  const fromX2 = absoluteAxis2(record.from, 'x');
  const fromY2 = absoluteAxis2(record.from, 'y');
  const toX2 = absoluteAxis2(record.to, 'x');
  const toY2 = absoluteAxis2(record.to, 'y');
  const radius2 = 2n * BigInt(record.radiusQ16);
  const minX2 = (fromX2 < toX2 ? fromX2 : toX2) - radius2;
  const maxX2 = (fromX2 > toX2 ? fromX2 : toX2) + radius2;
  const minY2 = (fromY2 < toY2 ? fromY2 : toY2) - radius2;
  const maxY2 = (fromY2 > toY2 ? fromY2 : toY2) + radius2;
  return Object.freeze({
    minChunkX: Number(floorDiv(minX2, BI_CHUNK_SPAN_2)),
    maxChunkX: Number(floorDiv(maxX2, BI_CHUNK_SPAN_2)),
    minChunkY: Number(floorDiv(minY2, BI_CHUNK_SPAN_2)),
    maxChunkY: Number(floorDiv(maxY2, BI_CHUNK_SPAN_2))
  });
}

export function analyzePlateCausality(recipeInput, targetTick) {
  const recipe = createRecipe(recipeInput);
  const tick = assertNonnegativeInteger(targetTick, 'targetTick', UINT32_MAX);
  let finiteFieldSupportQ16 = 0;
  const globalPureOperators = new Set();
  const localOperators = new Set();
  for (const layer of recipe.fields.layers) {
    const descriptor = FIELD_OPERATOR_REGISTRY[layer.operator];
    if (!descriptor) throw new RangeError(`Infinite Plate cannot classify unknown field operator ${String(layer.operator)}.`);
    if (descriptor.support === 'finite-chebyshev') {
      const radius = layer.parameters?.radiusQ16 ?? 0;
      if (!Number.isInteger(radius) || radius <= 0 || radius > INT32_MAX) throw new RangeError(`Field ${layer.id} has invalid finite support radius.`);
      finiteFieldSupportQ16 = Math.max(finiteFieldSupportQ16, radius);
    } else if (descriptor.support === 'global' || descriptor.support === 'global-procedural') {
      if (!['uniform', 'turbulence'].includes(layer.operator)) {
        throw new RangeError(`Global operator ${layer.operator} is not approved as a pure deterministic world function for Infinite Plate.`);
      }
      globalPureOperators.add(layer.operator);
    } else if (descriptor.support === 'stack-transform') {
      localOperators.add(layer.operator);
    } else {
      throw new RangeError(`Field operator ${layer.operator} has unsupported causal support ${String(descriptor.support)}.`);
    }
  }
  const halo = BigInt(tick) * BigInt(MAX_STEP_DISPLACEMENT_Q16)
    + BigInt(finiteFieldSupportQ16)
    + BigInt(MAX_MATERIAL_INTERACTION_RADIUS_Q16);
  return Object.freeze({
    method: INFINITE_PLATE_METHOD,
    targetTick: tick,
    maxStepDisplacementQ16: MAX_STEP_DISPLACEMENT_Q16,
    finiteFieldSupportQ16,
    depositionRadiusQ16: MAX_MATERIAL_INTERACTION_RADIUS_Q16,
    causalHaloQ16: halo.toString(),
    globalPureOperators: Object.freeze([...globalPureOperators].sort()),
    localOperators: Object.freeze([...localOperators].sort())
  });
}

function semanticPrefix(recipe, tick, options) {
  return canonicalHash({
    version: INFINITE_PLATE_VERSION,
    method: INFINITE_PLATE_METHOD,
    simulationVersion: SIMULATION_VERSION,
    recipeHash: recipeHash(recipe),
    schemaVersion: recipe.schemaVersion,
    engineVersion: recipe.engineVersion,
    targetTick: tick,
    agentCapacity: options.agentCapacity,
    maxDepositions: options.maxDepositions
  });
}

function cacheKey(prefix, chunk) {
  return `${prefix}:${chunk.chunkX},${chunk.chunkY}`;
}

export class InfinitePlateViewSession {
  constructor(center = { chunkX: 0, chunkY: 0, localX: 0, localY: 0 }) {
    this._center = normalizeWorldPosition(center);
  }

  get center() { return Object.freeze({ ...this._center }); }

  setCenter(center) {
    this._center = normalizeWorldPosition(center);
    return this.center;
  }

  panByQ16(deltaXQ16, deltaYQ16) {
    assertInt32(deltaXQ16, 'deltaXQ16');
    assertInt32(deltaYQ16, 'deltaYQ16');
    this._center = translateWorldPosition(this._center, deltaXQ16, deltaYQ16);
    return this.center;
  }

  frame(widthPx, heightPx, unitsPerPixelQ16) {
    return normalizeExportCrop({ widthPx, heightPx, unitsPerPixelQ16, center: this._center });
  }
}

export class PlateChunkCache {
  constructor(capacity = DEFAULT_PLATE_CACHE_CHUNKS) {
    this.capacity = assertPositiveInteger(capacity, 'cache capacity', MAX_PLATE_CACHE_CHUNKS);
    this._entries = new Map();
  }

  get size() { return this._entries.size; }

  setCapacity(capacity) {
    this.capacity = assertPositiveInteger(capacity, 'cache capacity', MAX_PLATE_CACHE_CHUNKS);
    this._evict();
    return this.capacity;
  }

  clear() { this._entries.clear(); }

  get(key) {
    const value = this._entries.get(key);
    if (!value) return null;
    this._entries.delete(key);
    this._entries.set(key, value);
    return value;
  }

  set(key, value) {
    if (typeof key !== 'string' || key.length === 0) throw new TypeError('cache key must be a non-empty string.');
    this._entries.delete(key);
    this._entries.set(key, value);
    this._evict();
  }

  _evict() {
    while (this._entries.size > this.capacity) this._entries.delete(this._entries.keys().next().value);
  }
}

export class PlateEvaluationAbortedError extends Error {
  constructor() {
    super('Infinite Plate evaluation was cancelled.');
    this.name = 'PlateEvaluationAbortedError';
  }
}

function normalizeEvaluationOptions(recipeInput, options) {
  assertPlainObject(options, 'Infinite Plate evaluation options');
  const recipe = createRecipe(recipeInput);
  const targetTick = assertNonnegativeInteger(options.targetTick ?? 0, 'targetTick', UINT32_MAX);
  const crop = normalizeExportCrop(options.crop ?? recipe.framing);
  const agentCapacity = assertPositiveInteger(options.agentCapacity ?? 8192, 'agentCapacity', 1_000_000);
  const maxDepositions = assertPositiveInteger(options.maxDepositions ?? 1_000_000, 'maxDepositions', 10_000_000);
  const maxWorkUnits = assertPositiveInteger(options.maxWorkUnits ?? DEFAULT_MAX_EVALUATION_WORK, 'maxWorkUnits', Number.MAX_SAFE_INTEGER);
  const workUnits = BigInt(targetTick) * BigInt(agentCapacity);
  if (workUnits > BigInt(maxWorkUnits)) {
    throw new RangeError(`Infinite Plate evaluation estimate ${workUnits} tick-agent slots exceeds safeguard ${maxWorkUnits}. Reduce target tick/capacity or raise maxWorkUnits explicitly.`);
  }
  const pixelCount = crop.widthPx * crop.heightPx;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > MAX_ASSEMBLED_PIXELS) {
    throw new RangeError(`Interactive Infinite Plate evaluation is limited to ${MAX_ASSEMBLED_PIXELS} assembled pixels; use smaller framing or the tiled export path.`);
  }
  const chunks = chunksForCrop(crop, options.maxRequestChunks ?? MAX_PLATE_REQUEST_CHUNKS);
  const backgroundRgba8 = normalizeBackground(options.backgroundRgba8);
  const tileWidthPx = assertPositiveInteger(options.tileWidthPx ?? DEFAULT_TILE_SIZE, 'tileWidthPx', 100_000);
  const tileHeightPx = assertPositiveInteger(options.tileHeightPx ?? DEFAULT_TILE_SIZE, 'tileHeightPx', 100_000);
  const prefix = semanticPrefix(recipe, targetTick, { agentCapacity, maxDepositions });
  const causality = analyzePlateCausality(recipe, targetTick);
  const domain = Object.freeze({ crop, chunks, causalHaloQ16: causality.causalHaloQ16 });
  const domainHash = canonicalHash({ version: INFINITE_PLATE_VERSION, prefix, domain });
  return Object.freeze({ recipe, targetTick, crop, agentCapacity, maxDepositions, maxWorkUnits, workUnits: workUnits.toString(), chunks, backgroundRgba8, tileWidthPx, tileHeightPx, prefix, causality, domain, domainHash });
}

function entriesForRequest(cache, prepared) {
  const entries = [];
  let misses = 0;
  for (const chunk of prepared.chunks) {
    const entry = cache.get(cacheKey(prepared.prefix, chunk));
    if (!entry) misses += 1;
    entries.push(entry);
  }
  return { entries, misses };
}

function indexReplayIntoChunks(replay, prepared, cache) {
  const requested = new Map(prepared.chunks.map((chunk) => [chunkKey(chunk.chunkX, chunk.chunkY), []]));
  for (const record of replay.simulation.depositions) {
    const range = depositionChunkRange(record);
    for (let chunkY = range.minChunkY; chunkY <= range.maxChunkY; chunkY += 1) {
      for (let chunkX = range.minChunkX; chunkX <= range.maxChunkX; chunkX += 1) {
        const key = chunkKey(chunkX, chunkY);
        const bucket = requested.get(key);
        if (bucket) bucket.push(record);
      }
    }
  }
  const source = Object.freeze({
    stateHash: replay.stateHash(),
    depositionHash: replay.depositionHash(),
    resultHash: replay.resultHash(),
    depositionCount: replay.simulation.depositions.length
  });
  const entries = [];
  for (const chunk of prepared.chunks) {
    const depositions = Object.freeze(requested.get(chunkKey(chunk.chunkX, chunk.chunkY)) ?? []);
    const entry = Object.freeze({
      version: INFINITE_PLATE_VERSION,
      prefix: prepared.prefix,
      chunk,
      source,
      depositions
    });
    cache.set(cacheKey(prepared.prefix, chunk), entry);
    entries.push(entry);
  }
  return entries;
}

function validateCachedEntries(entries, prepared) {
  if (entries.some((entry) => !entry)) return false;
  const reference = entries[0]?.source;
  if (!reference) return false;
  return entries.every((entry, index) => entry.prefix === prepared.prefix
    && entry.chunk.chunkX === prepared.chunks[index].chunkX
    && entry.chunk.chunkY === prepared.chunks[index].chunkY
    && entry.source.stateHash === reference.stateHash
    && entry.source.depositionHash === reference.depositionHash
    && entry.source.resultHash === reference.resultHash);
}

function finalizeEvaluation(prepared, entries, cacheHit) {
  if (!validateCachedEntries(entries, prepared)) throw new Error('Infinite Plate cache entries failed semantic consistency validation.');
  const bySequence = new Map();
  for (const entry of entries) {
    for (const record of entry.depositions) bySequence.set(record.sequence, record);
  }
  const depositions = Object.freeze([...bySequence.values()].sort((a, b) => a.sequence - b.sequence));
  const rgba = rasterizeDepositionsTiled(depositions, prepared.crop, {
    backgroundRgba8: prepared.backgroundRgba8,
    tileWidthPx: prepared.tileWidthPx,
    tileHeightPx: prepared.tileHeightPx
  });
  const rgbaHash = rawRgbaHash(rgba);
  const depositionHash = canonicalHash({ version: INFINITE_PLATE_VERSION, domainHash: prepared.domainHash, depositions });
  const source = entries[0].source;
  const resultHash = canonicalHash({
    version: INFINITE_PLATE_VERSION,
    method: INFINITE_PLATE_METHOD,
    domainHash: prepared.domainHash,
    sourceStateHash: source.stateHash,
    depositionHash,
    rawRgbaHash: rgbaHash
  });
  return Object.freeze({
    version: INFINITE_PLATE_VERSION,
    method: INFINITE_PLATE_METHOD,
    recipe: prepared.recipe,
    recipeHash: recipeHash(prepared.recipe),
    targetTick: prepared.targetTick,
    crop: prepared.crop,
    domain: prepared.domain,
    domainHash: prepared.domainHash,
    causality: prepared.causality,
    sourceStateHash: source.stateHash,
    sourceDepositionHash: source.depositionHash,
    sourceResultHash: source.resultHash,
    sourceDepositionCount: source.depositionCount,
    depositionHash,
    resultHash,
    depositions,
    depositionCount: depositions.length,
    rgba,
    rawRgbaHash: rgbaHash,
    backgroundRgba8: prepared.backgroundRgba8,
    cacheHit,
    chunkCount: prepared.chunks.length,
    workUnits: prepared.workUnits
  });
}

export class InfinitePlateEvaluator {
  constructor(options = {}) {
    assertPlainObject(options, 'InfinitePlateEvaluator options');
    this.cache = options.cache instanceof PlateChunkCache ? options.cache : new PlateChunkCache(options.cacheChunks ?? DEFAULT_PLATE_CACHE_CHUNKS);
  }

  setCacheCapacity(capacity) { return this.cache.setCapacity(capacity); }
  clearCache() { this.cache.clear(); }

  evaluate(recipeInput, options = {}) {
    const prepared = normalizeEvaluationOptions(recipeInput, options);
    const cached = entriesForRequest(this.cache, prepared);
    if (cached.misses === 0 && validateCachedEntries(cached.entries, prepared)) return finalizeEvaluation(prepared, cached.entries, true);
    const replay = createRecipeReplay(prepared.recipe, { capacity: prepared.agentCapacity, maxDepositions: prepared.maxDepositions });
    replay.runToTick(prepared.targetTick);
    const entries = indexReplayIntoChunks(replay, prepared, this.cache);
    return finalizeEvaluation(prepared, entries, false);
  }

  async evaluateAsync(recipeInput, options = {}) {
    const prepared = normalizeEvaluationOptions(recipeInput, options);
    const cached = entriesForRequest(this.cache, prepared);
    if (cached.misses === 0 && validateCachedEntries(cached.entries, prepared)) return finalizeEvaluation(prepared, cached.entries, true);
    const signal = options.signal ?? null;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const tickBatch = assertPositiveInteger(options.tickBatch ?? DEFAULT_ASYNC_TICK_BATCH, 'tickBatch', 65536);
    const yieldControl = typeof options.yieldControl === 'function'
      ? options.yieldControl
      : () => new Promise((resolve) => setTimeout(resolve, 0));
    const replay = createRecipeReplay(prepared.recipe, { capacity: prepared.agentCapacity, maxDepositions: prepared.maxDepositions });
    while (replay.simulation.tick < prepared.targetTick) {
      if (signal?.aborted) throw new PlateEvaluationAbortedError();
      const count = Math.min(tickBatch, prepared.targetTick - replay.simulation.tick);
      replay.runTicks(count);
      onProgress?.(Object.freeze({ tick: replay.simulation.tick, targetTick: prepared.targetTick }));
      if (replay.simulation.tick < prepared.targetTick) await yieldControl();
    }
    if (signal?.aborted) throw new PlateEvaluationAbortedError();
    const entries = indexReplayIntoChunks(replay, prepared, this.cache);
    return finalizeEvaluation(prepared, entries, false);
  }

  async prefetchAsync(recipeInput, requests, options = {}) {
    if (!Array.isArray(requests)) throw new TypeError('prefetch requests must be an array.');
    const results = [];
    for (const request of requests) {
      if (options.signal?.aborted) throw new PlateEvaluationAbortedError();
      results.push(await this.evaluateAsync(recipeInput, { ...options, ...request }));
    }
    return Object.freeze(results);
  }
}

export function plateRequestIdentity(recipeInput, options = {}) {
  const prepared = normalizeEvaluationOptions(recipeInput, options);
  return canonicalStringify({
    version: INFINITE_PLATE_VERSION,
    method: INFINITE_PLATE_METHOD,
    prefix: prepared.prefix,
    domainHash: prepared.domainHash
  });
}
