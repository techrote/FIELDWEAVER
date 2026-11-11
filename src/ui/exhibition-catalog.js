import { createCanonicalExport } from '../export/index.js';
import { BUILTIN_PRESETS, getBuiltinPreset } from '../presets/index.js';

export const EXHIBITION_VERSION = 'fw-exhibition-v1';

// Accepted catalogue entries are the same immutable, golden-tested recipes
// shipped with the instrument. A gallery selection is never a recipe edit.
export function exhibitionEntries() {
  return Object.freeze(BUILTIN_PRESETS.map((preset) => Object.freeze({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    coverage: preset.coverage,
    recipeHash: preset.recipeHash,
    seed: preset.recipe.seed >>> 0,
    targetTick: preset.targetTick,
    exportCrop: preset.exportCrop,
    lineage: preset.recipe.lineage
  })));
}

export function nextExhibitionId(currentId, offset) {
  if (!Number.isInteger(offset)) throw new TypeError('Exhibition offset must be an integer.');
  const index = BUILTIN_PRESETS.findIndex((preset) => preset.id === currentId);
  if (index < 0) throw new RangeError('Unknown exhibition selection: ' + String(currentId));
  return BUILTIN_PRESETS[((index + offset) % BUILTIN_PRESETS.length + BUILTIN_PRESETS.length) % BUILTIN_PRESETS.length].id;
}

// This is the actual authoritative CPU software export, not a WebGL, CSS,
// Canvas2D, stock-image or pre-rendered approximation. Framing and tick are
// taken directly from the accepted preset and cannot be supplied by the UI.
export function renderExhibitionProof(id) {
  const preset = getBuiltinPreset(id);
  const result = createCanonicalExport(preset.recipe, {
    targetTick: preset.targetTick,
    crop: preset.exportCrop,
    agentCapacity: 4096,
    maxDepositions: 250_000,
    tileWidthPx: 32,
    tileHeightPx: 32
  });
  if (result.recipeHash !== preset.recipeHash) {
    throw new Error('Exhibition recipe identity mismatch; refusing preview.');
  }
  return Object.freeze({ ...result, exhibitionVersion: EXHIBITION_VERSION, presetId: id });
}
