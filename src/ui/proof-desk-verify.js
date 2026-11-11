import { canonicalStringify } from '../core/canonical.js';
import { createRecipe, recipeHash } from '../recipe/index.js';
import {
  createCanonicalExport,
  decodePngRgba,
  EXPORT_PROVENANCE_VERSION,
  EXPORT_PACKAGE_VERSION,
  CANONICAL_RASTER_VERSION,
  PNG_PACKAGE_VERSION
} from '../export/index.js';

// Deliberately bounded: this is a human-scale inspection desk, not a render farm.
export const PROOF_DESK_LIMITS = Object.freeze({
  provenanceBytes: 4 * 1024 * 1024,
  pngBytes: 8 * 1024 * 1024,
  maxTick: 512,
  maxDimension: 1024,
  maxPixels: 1_048_576,
  agentCapacity: 4096,
  maxDepositions: 250_000
});

const PROVENANCE_KEYS = Object.freeze([
  'version', 'exportVersion', 'rasterVersion', 'pngVersion', 'recipeHash',
  'recipe', 'seed', 'schemaVersion', 'engineVersion', 'targetTick', 'crop',
  'widthPx', 'heightPx', 'unitsPerPixelQ16', 'backgroundRgba8',
  'pixelFormat', 'rawRgbaHash', 'stateHash', 'depositionHash', 'resultHash',
  'lineage'
]);

function object(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(name + ' must be an object.');
  }
  return value;
}

function compare(label, supplied, calculated) {
  if (canonicalStringify(supplied) !== canonicalStringify(calculated)) {
    throw new Error(label + ' does not match the independently replayed canonical export.');
  }
}

function preflight(provenance) {
  object(provenance, 'Provenance');
  if (provenance.version !== EXPORT_PROVENANCE_VERSION ||
    provenance.exportVersion !== EXPORT_PACKAGE_VERSION ||
    provenance.rasterVersion !== CANONICAL_RASTER_VERSION ||
    provenance.pngVersion !== PNG_PACKAGE_VERSION) {
    throw new Error('Unsupported canonical provenance/export/raster/PNG version.');
  }
  const keys = Object.keys(provenance).sort();
  compare('Provenance field set', keys, [...PROVENANCE_KEYS].sort());
  if (!Number.isInteger(provenance.targetTick) ||
    provenance.targetTick < 0 || provenance.targetTick > PROOF_DESK_LIMITS.maxTick) {
    throw new RangeError('Target tick is outside proof desk budget (0–512).');
  }
  const crop = object(provenance.crop, 'Crop');
  if (!Number.isInteger(crop.widthPx) || !Number.isInteger(crop.heightPx) ||
    crop.widthPx < 1 || crop.heightPx < 1 ||
    crop.widthPx > PROOF_DESK_LIMITS.maxDimension ||
    crop.heightPx > PROOF_DESK_LIMITS.maxDimension ||
    crop.widthPx * crop.heightPx > PROOF_DESK_LIMITS.maxPixels) {
    throw new RangeError('Crop exceeds proof desk budget (1024 per side; 1,048,576 pixels).');
  }
  const recipe = createRecipe(provenance.recipe);
  compare('Recipe hash', provenance.recipeHash, recipeHash(recipe));
  compare('Unsigned seed', provenance.seed, recipe.seed);
  compare('Recipe schema', provenance.schemaVersion, recipe.schemaVersion);
  compare('Recipe engine', provenance.engineVersion, recipe.engineVersion);
  compare('Recipe lineage', provenance.lineage, recipe.lineage);
  compare('Normalized recipe', provenance.recipe, recipe);
  compare('Width', provenance.widthPx, crop.widthPx);
  compare('Height', provenance.heightPx, crop.heightPx);
  compare('Units per pixel', provenance.unitsPerPixelQ16, crop.unitsPerPixelQ16);
  if (provenance.pixelFormat !== 'rgba8') throw new Error('Only canonical rgba8 provenance is supported.');
  return recipe;
}

function verifySuppliedPng(bytes, proof) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Archived PNG must be Uint8Array.');
  if (bytes.byteLength > PROOF_DESK_LIMITS.pngBytes) {
    throw new RangeError('Archived PNG exceeds the 8 MiB review budget.');
  }
  // Bound allocations before invoking the strict canonical PNG decoder.
  if (bytes.length < 33) throw new RangeError('Archived PNG is truncated.');
  const width = ((bytes[16] * 0x1000000) + (bytes[17] << 16) + (bytes[18] << 8) + bytes[19]) >>> 0;
  const height = ((bytes[20] * 0x1000000) + (bytes[21] << 16) + (bytes[22] << 8) + bytes[23]) >>> 0;
  if (width !== proof.crop.widthPx || height !== proof.crop.heightPx) {
    throw new Error('Archived PNG dimensions disagree with canonical crop.');
  }
  const decoded = decodePngRgba(bytes);
  if (decoded.rgba.length !== proof.rgba.length) throw new Error('Archived PNG RGBA size mismatch.');
  for (let i = 0; i < proof.rgba.length; i += 1) {
    if (decoded.rgba[i] !== proof.rgba[i]) {
      throw new Error('Archived PNG differs from canonical decoded RGBA8 at byte ' + i + '.');
    }
  }
}

// No DOM, WebGL, canvas, clocks or network. Replays supplied versioned recipe
// and verifies every FW-012 provenance field, with an optional strict RGBA PNG.
export function verifyProofPackage(provenance, archivedPng = null) {
  const recipe = preflight(provenance);
  const proof = createCanonicalExport(recipe, {
    targetTick: provenance.targetTick,
    crop: provenance.crop,
    backgroundRgba8: provenance.backgroundRgba8,
    agentCapacity: PROOF_DESK_LIMITS.agentCapacity,
    maxDepositions: PROOF_DESK_LIMITS.maxDepositions,
    tileWidthPx: 47,
    tileHeightPx: 39
  });
  for (const key of PROVENANCE_KEYS) compare('Provenance.' + key, provenance[key], proof.provenance[key]);
  if (archivedPng !== null) verifySuppliedPng(archivedPng, proof);
  return Object.freeze({ proof, archivedPngChecked: archivedPng !== null });
}
