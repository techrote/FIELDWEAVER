import { normalizeWorldPosition } from '../core/coordinates.js';
import { Q16_ONE } from '../core/numeric.js';
import { FieldLayerCollection } from '../fields/index.js';
import { createBuiltinLuts, createDefaultLutMappings } from '../lut/index.js';
import { mutateRecipe } from '../mutation/index.js';
import { createRecipe, recipeHash } from '../recipe/index.js';
import { createBaselineMaterials } from '../sim/index.js';

export const PRESET_CATALOG_VERSION = 'fw-presets-v1';

function world(localUnitsX, localUnitsY, chunkX = 0, chunkY = 0) {
  return normalizeWorldPosition({
    chunkX,
    chunkY,
    localX: Math.round(localUnitsX * Q16_ONE),
    localY: Math.round(localUnitsY * Q16_ONE)
  });
}

function fieldStack(seed, { allOperators = false, chunkX = 0, chunkY = 0 } = {}) {
  const fields = new FieldLayerCollection();
  fields.createLayer({ id: 1, kind: 'vector', operator: 'uniform', blend: 'add', parameters: { vectorXQ16: Math.round(Q16_ONE / 18), vectorYQ16: Math.round(Q16_ONE / 64) } });
  fields.createLayer({ id: 2, kind: 'vector', operator: 'vortex', blend: 'add', transform: { origin: world(142, 128, chunkX, chunkY) }, parameters: { strengthQ16: Math.round(Q16_ONE / 2), radiusQ16: 88 * Q16_ONE } });
  if (allOperators) {
    fields.createLayer({ id: 3, kind: 'vector', operator: 'attractor', blend: 'add', transform: { origin: world(102, 154, chunkX, chunkY) }, parameters: { strengthQ16: Math.round(Q16_ONE / 3), radiusQ16: 72 * Q16_ONE } });
    fields.createLayer({ id: 4, kind: 'vector', operator: 'turbulence', blend: 'add', parameters: { seed: seed | 0, amplitudeQ16: Math.round(Q16_ONE / 5), cellSizeQ16: 16 * Q16_ONE } });
    fields.createLayer({ id: 5, kind: 'vector', operator: 'direction-quantizer', blend: 'add', parameters: { sectors: 8 } });
  }
  return fields.toCanonical();
}

function fourMaterialEmitters({ chunkX = 0, chunkY = 0 } = {}) {
  return createBaselineMaterials().map((material, index) => ({
    id: index + 1,
    materialId: material.id,
    startTick: index * 2,
    stopTick: 52 + index * 4,
    intervalTicks: material.kind === 'dust' ? 2 : 1,
    rate: material.kind === 'filament' ? 1 : 2,
    bursts: [{ tick: 10 + index * 5, count: 4 + index * 2 }],
    geometry: { type: 'box', origin: world(58, 78 + index * 31, chunkX, chunkY), widthQ16: 6 * Q16_ONE, heightQ16: 6 * Q16_ONE },
    velocityXQ16: material.kind === 'shard' ? Math.round(Q16_ONE * 1.15) : Math.round(Q16_ONE * 0.8),
    velocityYQ16: Math.round((index - 1.5) * Q16_ONE / 16),
    velocityJitterQ16: Math.round(Q16_ONE / 10)
  }));
}

function commonRecipe(seed, options = {}) {
  return createRecipe({
    seed,
    framing: options.framing,
    fields: fieldStack(seed, options),
    materials: createBaselineMaterials(),
    emitters: fourMaterialEmitters(options),
    lut: { assets: createBuiltinLuts(), mappings: createDefaultLutMappings() },
    commands: options.commands ?? [],
    lineage: null
  });
}

const firstWeave = commonRecipe(0x46d2a71b, {});
const operatorAtlas = commonRecipe(0x14a71a5e, { allOperators: true });
const timelinePulse = commonRecipe(0x710e11e5, {
  allOperators: true,
  commands: [
    { id: 10, tick: 8, type: 'set-emitter-rate', emitterId: 1, rate: 4 },
    { id: 20, tick: 12, type: 'release-burst', emitterId: 3, count: 12 },
    { id: 30, tick: 18, type: 'set-field-enabled', fieldId: 3, enabled: false },
    { id: 40, tick: 24, type: 'set-simulation-frozen', frozen: true },
    { id: 50, tick: 28, type: 'set-simulation-frozen', frozen: false },
    { id: 60, tick: 34, type: 'set-material-parameter', materialId: 4, parameter: 'steeringNumerator', value: 3 }
  ]
});

const farChunkX = 12;
const farChunkY = -7;
const infiniteParent = commonRecipe(0x1f1e7e55, {
  allOperators: true,
  chunkX: farChunkX,
  chunkY: farChunkY,
  framing: { widthPx: 960, heightPx: 640, center: world(128, 128, farChunkX, farChunkY), unitsPerPixelQ16: Math.round(Q16_ONE / 4) }
});
const infiniteLineage = mutateRecipe(infiniteParent, { mutationSeed: 0x5eed014, siblingIndex: 2, scope: 'seed', intensity: 'subtle', operationCount: 1 }).recipe;

function exportCrop(recipe, widthPx = 96, heightPx = 64, unitsPerPixelQ16 = 2 * Q16_ONE) {
  return Object.freeze({ widthPx, heightPx, center: Object.freeze({ ...recipe.framing.center }), unitsPerPixelQ16 });
}
function entry({ id, name, description, recipe, targetTick, coverage }) {
  return Object.freeze({ id, name, description, catalogVersion: PRESET_CATALOG_VERSION, targetTick, coverage: Object.freeze([...coverage]), recipe, recipeHash: recipeHash(recipe), exportCrop: exportCrop(recipe) });
}

export const BUILTIN_PRESETS = Object.freeze([
  entry({ id: 'first-weave', name: 'First Weave', description: 'Immediate four-material composition using a uniform drift, vortex, colour LUT, and behaviour LUT.', recipe: firstWeave, targetTick: 48, coverage: ['uniform', 'vortex', 'ink', 'filament', 'dust', 'shard', 'lut-color', 'lut-behaviour'] }),
  entry({ id: 'operator-atlas', name: 'Operator Atlas', description: 'All five deterministic field operators composed in one compact recipe.', recipe: operatorAtlas, targetTick: 40, coverage: ['uniform', 'vortex', 'attractor', 'turbulence', 'direction-quantizer', 'mixed-field-stack'] }),
  entry({ id: 'timeline-pulse', name: 'Timeline Pulse', description: 'A command-rich score demonstrating intervention replay, freeze/resume, bursts, and parameter edits.', recipe: timelinePulse, targetTick: 44, coverage: ['timeline', 'commands', 'freeze-resume', 'burst', 'lut-behaviour'] }),
  entry({ id: 'infinite-lineage', name: 'Infinite Lineage', description: 'A far-world crop with deterministic mutation lineage for Infinite Plate framing and provenance.', recipe: infiniteLineage, targetTick: 36, coverage: ['infinite-plate', 'far-chunk', 'lineage', 'mutation', 'canonical-export'] })
]);
const PRESET_BY_ID = new Map(BUILTIN_PRESETS.map((preset) => [preset.id, preset]));
export function getBuiltinPreset(id) {
  const preset = PRESET_BY_ID.get(String(id));
  if (!preset) throw new RangeError(`Unknown FIELDWEAVER preset: ${String(id)}.`);
  return preset;
}
