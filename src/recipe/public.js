import { canonicalHash } from '../core/canonical.js';
import { SIMULATION_VERSION } from '../sim/index.js';
import {
  RECIPE_SCHEMA_VERSION,
  DEFAULT_RECIPE_FRAMING,
  migrateRecipe as migrateRecipeRaw,
  normalizeRecipe as normalizeRecipeRaw
} from './model.js';

function withoutNullStopTick(emitter) {
  if (emitter === null || typeof emitter !== 'object' || Array.isArray(emitter) || emitter.stopTick !== null) return emitter;
  const { stopTick: _stopTick, ...rest } = emitter;
  return rest;
}

function sanitizeLineage(lineage) {
  if (lineage === null || lineage === undefined || typeof lineage !== 'object' || Array.isArray(lineage)) return lineage;
  if (lineage.version === undefined) return lineage;
  const {
    version,
    parentRecipeHash,
    childIdentity,
    mutationSeed,
    siblingIndex,
    childSeed,
    operations = []
  } = lineage;
  if (version !== 'fw-lineage-v1') return lineage;
  const identityOperation = {
    version,
    type: 'lineage-identity',
    childIdentity,
    mutationSeed,
    siblingIndex
  };
  return { parentRecipeHash, childSeed, operations: [identityOperation, ...operations] };
}

function sanitizeRecipeInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return input;
  const emitters = Array.isArray(input.emitters) ? input.emitters.map(withoutNullStopTick) : input.emitters;
  const lineage = sanitizeLineage(input.lineage);
  if (emitters === input.emitters && lineage === input.lineage) return input;
  return { ...input, emitters, lineage };
}

function sanitizeNormalizedRecipe(recipe) {
  const emitters = Object.freeze(recipe.emitters.map((emitter) => {
    const sanitized = withoutNullStopTick(emitter);
    return sanitized === emitter ? emitter : Object.freeze(sanitized);
  }));
  return Object.freeze({ ...recipe, emitters });
}

export function migrateRecipe(input) {
  return sanitizeRecipeInput(migrateRecipeRaw(sanitizeRecipeInput(input)));
}

export function normalizeRecipe(input) {
  return sanitizeNormalizedRecipe(normalizeRecipeRaw(sanitizeRecipeInput(input)));
}

export function createRecipe(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Recipe input must be a plain object.');
  return normalizeRecipe({
    schemaVersion: input.schemaVersion ?? RECIPE_SCHEMA_VERSION,
    engineVersion: input.engineVersion ?? SIMULATION_VERSION,
    seed: input.seed,
    framing: input.framing ?? DEFAULT_RECIPE_FRAMING,
    fields: input.fields,
    materials: input.materials,
    emitters: input.emitters,
    lut: input.lut ?? { assets: [], mappings: [] },
    commands: input.commands ?? [],
    lineage: input.lineage ?? null
  });
}

export function recipeHash(input) {
  return canonicalHash(normalizeRecipe(input));
}

export function serializeRecipe(input) {
  return `${JSON.stringify(normalizeRecipe(input), null, 2)}\n`;
}

export function parseRecipe(text) {
  if (typeof text !== 'string') throw new TypeError('Recipe JSON must be text.');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new SyntaxError(`Invalid recipe JSON: ${error.message}`);
  }
  return normalizeRecipe(parsed);
}
