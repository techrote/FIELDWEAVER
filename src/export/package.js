import { canonicalStringify } from '../core/canonical.js';
import { createRecipe, recipeHash, replayRecipeToTick } from '../recipe/index.js';
import { SIMULATION_VERSION } from '../sim/index.js';
import {
  CANONICAL_RASTER_VERSION,
  DEFAULT_EXPORT_BACKGROUND_RGBA8,
  DEFAULT_TILE_SIZE,
  normalizeExportCrop,
  rasterizeDepositionsTiled,
  rawRgbaHash
} from './raster.js';
import { PNG_PACKAGE_VERSION, encodePngRgba } from './png.js';

export const EXPORT_PACKAGE_VERSION = 'fw-canonical-export-v1';
export const EXPORT_PROVENANCE_VERSION = 'fw-export-provenance-v1';
export const DEFAULT_EXPORT_AGENT_CAPACITY = 8192;
export const DEFAULT_EXPORT_MAX_DEPOSITIONS = 1_000_000;

const UINT32_MAX = 0xffffffff;

function assertPositiveInteger(value, label, max) {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new RangeError(`${label} must be an integer in [1, ${max}].`);
  return value;
}

function assertNonnegativeInteger(value, label, max) {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`${label} must be an integer in [0, ${max}].`);
  return value;
}

function cloneRgba(value) {
  if (!Array.isArray(value) || value.length !== 4) throw new TypeError('backgroundRgba8 must be a four-entry array.');
  const result = value.map((channel, index) => {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) throw new RangeError(`backgroundRgba8[${index}] must be an integer in [0, 255].`);
    return channel;
  });
  if (result[3] !== 255) throw new RangeError('Canonical export background alpha must be 255.');
  return Object.freeze(result);
}

export function createExportProvenance({ recipe, crop, targetTick, rgbaHash, replay, backgroundRgba8 }) {
  const normalizedRecipe = createRecipe(recipe);
  if (typeof rgbaHash !== 'string' || !/^[0-9a-f]{16}$/.test(rgbaHash)) throw new RangeError('rgbaHash must be a 16-character lowercase FNV-1a-64 hash.');
  return Object.freeze({
    version: EXPORT_PROVENANCE_VERSION,
    exportVersion: EXPORT_PACKAGE_VERSION,
    rasterVersion: CANONICAL_RASTER_VERSION,
    pngVersion: PNG_PACKAGE_VERSION,
    recipeHash: recipeHash(normalizedRecipe),
    recipe: normalizedRecipe,
    seed: normalizedRecipe.seed,
    schemaVersion: normalizedRecipe.schemaVersion,
    engineVersion: normalizedRecipe.engineVersion,
    targetTick,
    crop,
    widthPx: crop.widthPx,
    heightPx: crop.heightPx,
    unitsPerPixelQ16: crop.unitsPerPixelQ16,
    backgroundRgba8: Object.freeze([...backgroundRgba8]),
    pixelFormat: 'rgba8',
    rawRgbaHash: rgbaHash,
    stateHash: replay.stateHash(),
    depositionHash: replay.depositionHash(),
    resultHash: replay.resultHash(),
    lineage: normalizedRecipe.lineage
  });
}

export function serializeExportProvenance(provenance) {
  if (provenance === null || typeof provenance !== 'object') throw new TypeError('Export provenance must be an object.');
  return `${JSON.stringify(provenance, null, 2)}\n`;
}

export function canonicalExportIdentity(provenance) {
  if (provenance === null || typeof provenance !== 'object') throw new TypeError('Export provenance must be an object.');
  return canonicalStringify({
    version: provenance.version,
    rasterVersion: provenance.rasterVersion,
    recipeHash: provenance.recipeHash,
    targetTick: provenance.targetTick,
    crop: provenance.crop,
    backgroundRgba8: provenance.backgroundRgba8,
    rawRgbaHash: provenance.rawRgbaHash
  });
}

export function createCanonicalExport(recipeInput, options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Export options must be an object.');
  const recipe = createRecipe(recipeInput);
  const targetTick = assertNonnegativeInteger(options.targetTick ?? 0, 'targetTick', UINT32_MAX);
  const crop = normalizeExportCrop(options.crop ?? recipe.framing);
  const agentCapacity = assertPositiveInteger(options.agentCapacity ?? DEFAULT_EXPORT_AGENT_CAPACITY, 'agentCapacity', 1_000_000);
  const maxDepositions = assertPositiveInteger(options.maxDepositions ?? DEFAULT_EXPORT_MAX_DEPOSITIONS, 'maxDepositions', 10_000_000);
  const tileWidthPx = assertPositiveInteger(options.tileWidthPx ?? DEFAULT_TILE_SIZE, 'tileWidthPx', 100_000);
  const tileHeightPx = assertPositiveInteger(options.tileHeightPx ?? DEFAULT_TILE_SIZE, 'tileHeightPx', 100_000);
  const backgroundRgba8 = cloneRgba(options.backgroundRgba8 ?? DEFAULT_EXPORT_BACKGROUND_RGBA8);

  const replay = replayRecipeToTick(recipe, targetTick, { capacity: agentCapacity, maxDepositions });
  if (replay.simulation.tick !== targetTick) throw new Error(`Canonical export replay stopped at tick ${replay.simulation.tick}; expected ${targetTick}.`);
  const rgba = rasterizeDepositionsTiled(replay.simulation.depositions, crop, {
    backgroundRgba8,
    tileWidthPx,
    tileHeightPx
  });
  const rgbaHash = rawRgbaHash(rgba);
  const png = encodePngRgba(rgba, crop.widthPx, crop.heightPx);
  const provenance = createExportProvenance({ recipe, crop, targetTick, rgbaHash, replay, backgroundRgba8 });
  const provenanceJson = serializeExportProvenance(provenance);

  return Object.freeze({
    version: EXPORT_PACKAGE_VERSION,
    recipeHash: provenance.recipeHash,
    targetTick,
    crop,
    rgba,
    rawRgbaHash: rgbaHash,
    png,
    provenance,
    provenanceJson,
    stateHash: provenance.stateHash,
    depositionHash: provenance.depositionHash,
    resultHash: provenance.resultHash,
    depositionCount: replay.simulation.depositions.length,
    simulationVersion: SIMULATION_VERSION
  });
}
