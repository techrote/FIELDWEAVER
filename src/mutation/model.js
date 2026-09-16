import { canonicalHash, canonicalStringify } from '../core/canonical.js';
import { translateWorldPosition } from '../core/coordinates.js';
import { INT32_MAX, INT32_MIN, Q16_ONE, UINT32_MAX, assertUint32 } from '../core/numeric.js';
import { Xoshiro128StarStar, deriveSeed } from '../core/prng.js';
import { MAX_MATERIAL_INTERACTION_RADIUS_Q16 } from '../sim/index.js';
import { createRecipe, recipeHash } from '../recipe/index.js';

export const MUTATION_VERSION = 'fw-mutation-v1';
export const LINEAGE_VERSION = 'fw-lineage-v1';
export const MUTATION_SCOPES = Object.freeze(['all', 'parameters', 'fields', 'emitters', 'order', 'lut', 'seed']);
export const MUTATION_INTENSITIES = Object.freeze(['subtle', 'medium', 'bold']);
export const MUTATION_OPERATOR_TYPES = Object.freeze([
  'perturb-material-parameter',
  'adjust-field-strength-scale',
  'move-emitter',
  'swap-adjacent-fields',
  'substitute-lut',
  'derive-sibling-seed'
]);

const INTENSITY_RATIOS = Object.freeze({
  subtle: Object.freeze([1, 16]),
  medium: Object.freeze([1, 8]),
  bold: Object.freeze([1, 4])
});
const EMITTER_MOVE_UNITS = Object.freeze({ subtle: 4, medium: 16, bold: 64 });
const STREAM_TAGS = Object.freeze({
  selection: 0x46573110,
  'perturb-material-parameter': 0x46573111,
  'adjust-field-strength-scale': 0x46573112,
  'move-emitter': 0x46573113,
  'swap-adjacent-fields': 0x46573114,
  'substitute-lut': 0x46573115,
  'derive-sibling-seed': 0x46573116
});

export class MutationRejectedError extends Error {
  constructor(code, message, details = null, options = {}) {
    super(message, options);
    this.name = 'MutationRejectedError';
    this.code = code;
    this.details = details;
  }
}

function cloneCanonical(value) {
  return JSON.parse(canonicalStringify(value));
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a plain object.`);
  return value;
}

function assertCount(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer in [${minimum}, ${maximum}].`);
  }
  return value;
}

export function normalizeMutationConfig(input = {}) {
  assertPlainObject(input, 'mutation config');
  const mutationSeed = assertUint32(input.mutationSeed ?? 0, 'mutationSeed');
  const siblingIndex = assertUint32(input.siblingIndex ?? 0, 'siblingIndex');
  const scope = input.scope ?? 'all';
  if (!MUTATION_SCOPES.includes(scope)) throw new RangeError(`scope must be one of: ${MUTATION_SCOPES.join(', ')}.`);
  const intensity = input.intensity ?? 'medium';
  if (!MUTATION_INTENSITIES.includes(intensity)) throw new RangeError(`intensity must be one of: ${MUTATION_INTENSITIES.join(', ')}.`);
  const operationCount = assertCount(input.operationCount ?? 3, 'operationCount', 1, MUTATION_OPERATOR_TYPES.length);
  return Object.freeze({ version: MUTATION_VERSION, mutationSeed, siblingIndex, scope, intensity, operationCount });
}

function streamFor(parentSeed, config, type, ordinal = 0) {
  const streamId = deriveSeed(parentSeed, config.siblingIndex, STREAM_TAGS[type] ?? 0, ordinal >>> 0);
  return Xoshiro128StarStar.fromSeed(config.mutationSeed, streamId);
}

function boundedSigned(prng, maximum) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > INT32_MAX) throw new RangeError('maximum must be a positive int32.');
  const magnitude = 1 + prng.nextBounded(maximum);
  return prng.nextBounded(2) === 0 ? -magnitude : magnitude;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function ratioSpan(value, intensity, minimum = 1) {
  const [numerator, denominator] = INTENSITY_RATIOS[intensity];
  const absolute = BigInt(Math.abs(value));
  const scaled = Number((absolute * BigInt(numerator) + BigInt(denominator - 1)) / BigInt(denominator));
  return Math.max(minimum, Math.min(INT32_MAX, scaled));
}

function operationRecord(type, target, before, after, extra = {}) {
  return Object.freeze({
    version: MUTATION_VERSION,
    type,
    target,
    before: cloneCanonical(before),
    after: cloneCanonical(after),
    ...cloneCanonical(extra)
  });
}

function materialParameterCandidates(recipe) {
  const bounds = Object.freeze({
    lifetimeTicks: [1, UINT32_MAX],
    depositEvery: [1, UINT32_MAX],
    steeringNumerator: [0, INT32_MAX],
    strengthQ16: [0, INT32_MAX],
    radiusQ16: [1, MAX_MATERIAL_INTERACTION_RADIUS_Q16]
  });
  const candidates = [];
  for (const material of recipe.materials) {
    for (const name of Object.keys(bounds)) {
      if (Number.isInteger(material[name])) candidates.push({ materialId: material.id, name, bounds: bounds[name] });
    }
  }
  return candidates;
}

function perturbMaterialParameter(draft, config, ordinal) {
  const candidates = materialParameterCandidates(draft);
  if (candidates.length === 0) throw new MutationRejectedError('no-material-parameter', 'No supported numeric material parameter can be mutated.');
  const prng = streamFor(draft.seed, config, 'perturb-material-parameter', ordinal);
  const candidate = candidates[prng.nextBounded(candidates.length)];
  const material = draft.materials.find((entry) => entry.id === candidate.materialId);
  const before = material[candidate.name];
  const span = Math.min(INT32_MAX, ratioSpan(before, config.intensity));
  const delta = boundedSigned(prng, span);
  const after = clamp(before + delta, candidate.bounds[0], candidate.bounds[1]);
  material[candidate.name] = after === before
    ? (before < candidate.bounds[1] ? before + 1 : before - 1)
    : after;
  return operationRecord(
    'perturb-material-parameter',
    `materials[id=${candidate.materialId}].${candidate.name}`,
    before,
    material[candidate.name],
    { repair: 'clamp-to-validated-material-range' }
  );
}

function fieldAdjustmentCandidates(recipe) {
  const candidates = [];
  for (const layer of recipe.fields.layers) {
    if (layer.operator === 'attractor' || layer.operator === 'vortex') {
      candidates.push({ layerId: layer.id, kind: 'parameter', name: 'strengthQ16', minimum: INT32_MIN, maximum: INT32_MAX });
    } else if (layer.operator === 'turbulence') {
      candidates.push({ layerId: layer.id, kind: 'parameter', name: 'amplitudeQ16', minimum: 0, maximum: INT32_MAX });
    } else if (layer.operator === 'uniform') {
      candidates.push({ layerId: layer.id, kind: 'parameter', name: 'vectorXQ16', minimum: INT32_MIN, maximum: INT32_MAX });
      candidates.push({ layerId: layer.id, kind: 'parameter', name: 'vectorYQ16', minimum: INT32_MIN, maximum: INT32_MAX });
    }
    candidates.push({ layerId: layer.id, kind: 'scale', name: 'scaleXQ16', minimum: 1, maximum: INT32_MAX });
    candidates.push({ layerId: layer.id, kind: 'scale', name: 'scaleYQ16', minimum: 1, maximum: INT32_MAX });
  }
  return candidates;
}

function adjustFieldStrengthScale(draft, config, ordinal) {
  const candidates = fieldAdjustmentCandidates(draft);
  if (candidates.length === 0) throw new MutationRejectedError('no-field-adjustment', 'No field strength or scale can be mutated.');
  const prng = streamFor(draft.seed, config, 'adjust-field-strength-scale', ordinal);
  const candidate = candidates[prng.nextBounded(candidates.length)];
  const layer = draft.fields.layers.find((entry) => entry.id === candidate.layerId);
  const container = candidate.kind === 'scale' ? layer.transform : layer.parameters;
  const before = container[candidate.name] ?? (candidate.kind === 'scale' ? Q16_ONE : 0);
  const span = ratioSpan(before === 0 ? Q16_ONE : before, config.intensity);
  const after = clamp(before + boundedSigned(prng, span), candidate.minimum, candidate.maximum);
  container[candidate.name] = after === before
    ? (before < candidate.maximum ? before + 1 : before - 1)
    : after;
  return operationRecord(
    'adjust-field-strength-scale',
    `fields.layers[id=${candidate.layerId}].${candidate.kind === 'scale' ? 'transform.' : 'parameters.'}${candidate.name}`,
    before,
    container[candidate.name],
    { repair: 'clamp-to-field-contract' }
  );
}

function moveEmitter(draft, config, ordinal) {
  if (draft.emitters.length === 0) throw new MutationRejectedError('no-emitter', 'No emitter can be moved.');
  const prng = streamFor(draft.seed, config, 'move-emitter', ordinal);
  const emitter = draft.emitters[prng.nextBounded(draft.emitters.length)];
  const before = cloneCanonical(emitter.geometry.origin);
  const maximumQ16 = EMITTER_MOVE_UNITS[config.intensity] * Q16_ONE;
  let dxQ16 = boundedSigned(prng, maximumQ16);
  let dyQ16 = boundedSigned(prng, maximumQ16);
  if (dxQ16 === 0 && dyQ16 === 0) dxQ16 = 1;
  emitter.geometry.origin = cloneCanonical(translateWorldPosition(emitter.geometry.origin, dxQ16, dyQ16));
  return operationRecord('move-emitter', `emitters[id=${emitter.id}].geometry.origin`, before, emitter.geometry.origin, { dxQ16, dyQ16 });
}

function swapAdjacentFields(draft, config, ordinal) {
  if (draft.fields.order.length < 2) throw new MutationRejectedError('insufficient-fields', 'At least two field layers are required for an adjacent order swap.');
  const prng = streamFor(draft.seed, config, 'swap-adjacent-fields', ordinal);
  const index = prng.nextBounded(draft.fields.order.length - 1);
  const before = [...draft.fields.order];
  [draft.fields.order[index], draft.fields.order[index + 1]] = [draft.fields.order[index + 1], draft.fields.order[index]];
  const byId = new Map(draft.fields.layers.map((layer) => [layer.id, layer]));
  draft.fields.layers = draft.fields.order.map((id) => byId.get(id));
  return operationRecord('swap-adjacent-fields', 'fields.order', before, draft.fields.order, { index });
}

function assetSupportsMapping(asset, mapping) {
  if (mapping.destination === 'color') return ['r', 'g', 'b'].every((channel) => Object.hasOwn(asset.channels, channel));
  return Object.hasOwn(asset.channels, mapping.channel);
}

function lutSubstitutionCandidates(recipe) {
  const candidates = [];
  for (const mapping of recipe.lut.mappings) {
    const alternatives = recipe.lut.assets
      .filter((asset) => asset.id !== mapping.lutId && assetSupportsMapping(asset, mapping))
      .map((asset) => asset.id)
      .sort((a, b) => a - b);
    if (alternatives.length > 0) candidates.push({ mappingId: mapping.id, alternatives });
  }
  return candidates;
}

function substituteLut(draft, config, ordinal) {
  const candidates = lutSubstitutionCandidates(draft);
  if (candidates.length === 0) throw new MutationRejectedError('no-compatible-lut-substitution', 'No LUT mapping has a compatible alternative LUT asset.');
  const prng = streamFor(draft.seed, config, 'substitute-lut', ordinal);
  const candidate = candidates[prng.nextBounded(candidates.length)];
  const mapping = draft.lut.mappings.find((entry) => entry.id === candidate.mappingId);
  const before = mapping.lutId;
  mapping.lutId = candidate.alternatives[prng.nextBounded(candidate.alternatives.length)];
  return operationRecord('substitute-lut', `lut.mappings[id=${mapping.id}].lutId`, before, mapping.lutId, { compatibleAlternatives: candidate.alternatives });
}

function deriveSiblingSeed(draft, config, ordinal) {
  const before = draft.seed >>> 0;
  const after = deriveSeed(before, config.mutationSeed, config.siblingIndex, STREAM_TAGS['derive-sibling-seed'], ordinal >>> 0);
  draft.seed = after === before ? deriveSeed(after, 0xa5a5a5a5) : after;
  return operationRecord('derive-sibling-seed', 'seed', before, draft.seed, { derivation: 'deriveSeed(parentSeed, mutationSeed, siblingIndex, streamTag, ordinal)' });
}

const OPERATORS = Object.freeze({
  'perturb-material-parameter': perturbMaterialParameter,
  'adjust-field-strength-scale': adjustFieldStrengthScale,
  'move-emitter': moveEmitter,
  'swap-adjacent-fields': swapAdjacentFields,
  'substitute-lut': substituteLut,
  'derive-sibling-seed': deriveSiblingSeed
});

function candidateTypes(recipe, scope) {
  const types = [];
  const include = (type, applicable) => { if (applicable) types.push(type); };
  if (scope === 'all' || scope === 'parameters') include('perturb-material-parameter', materialParameterCandidates(recipe).length > 0);
  if (scope === 'all' || scope === 'fields') include('adjust-field-strength-scale', fieldAdjustmentCandidates(recipe).length > 0);
  if (scope === 'all' || scope === 'emitters') include('move-emitter', recipe.emitters.length > 0);
  if (scope === 'all' || scope === 'fields' || scope === 'order') include('swap-adjacent-fields', recipe.fields.order.length > 1);
  if (scope === 'all' || scope === 'lut') include('substitute-lut', lutSubstitutionCandidates(recipe).length > 0);
  if (scope === 'all' || scope === 'seed') include('derive-sibling-seed', true);
  return types;
}

function selectOperatorTypes(recipe, config) {
  const types = candidateTypes(recipe, config.scope);
  if (types.length === 0) {
    throw new MutationRejectedError('empty-mutation-scope', `No mutation operator is applicable for scope ${config.scope}.`, { scope: config.scope });
  }
  const prng = streamFor(recipe.seed, config, 'selection');
  const shuffled = [...types];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = prng.nextBounded(index + 1);
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled.slice(0, Math.min(config.operationCount, shuffled.length));
}

function stripLineage(recipe) {
  return { ...recipe, lineage: null };
}

function diffAtom(value) {
  return value === undefined ? null : cloneCanonical(value);
}

function deepDiff(before, after, path, output) {
  if (before === undefined || after === undefined) {
    if (before === after) return;
    output.push(Object.freeze({
      path,
      before: diffAtom(before),
      after: diffAtom(after),
      beforeMissing: before === undefined,
      afterMissing: after === undefined
    }));
    return;
  }
  if (canonicalStringify(before) === canonicalStringify(after)) return;
  const beforeObject = before !== null && typeof before === 'object';
  const afterObject = after !== null && typeof after === 'object';
  if (!beforeObject || !afterObject || Array.isArray(before) !== Array.isArray(after)) {
    output.push(Object.freeze({ path, before: cloneCanonical(before), after: cloneCanonical(after) }));
    return;
  }
  if (Array.isArray(before)) {
    if (before.length !== after.length) {
      output.push(Object.freeze({ path, before: cloneCanonical(before), after: cloneCanonical(after) }));
      return;
    }
    for (let index = 0; index < before.length; index += 1) deepDiff(before[index], after[index], `${path}[${index}]`, output);
    return;
  }
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const key of keys) deepDiff(before[key], after[key], path ? `${path}.${key}` : key, output);
}

export function diffRecipes(parentInput, childInput, options = {}) {
  const parent = createRecipe(parentInput);
  const child = createRecipe(childInput);
  const output = [];
  deepDiff(options.includeLineage ? parent : stripLineage(parent), options.includeLineage ? child : stripLineage(child), '', output);
  return Object.freeze(output);
}

export function mutateRecipe(parentInput, configInput = {}) {
  const parent = createRecipe(parentInput);
  const config = normalizeMutationConfig(configInput);
  const parentRecipeHash = recipeHash(parent);
  const draft = cloneCanonical({ ...parent, lineage: null });
  const types = selectOperatorTypes(draft, config);
  const operations = [];

  try {
    for (let ordinal = 0; ordinal < types.length; ordinal += 1) {
      operations.push(OPERATORS[types[ordinal]](draft, config, ordinal));
    }
  } catch (error) {
    if (error instanceof MutationRejectedError) throw error;
    throw new MutationRejectedError('operator-failed', `Mutation operator failed: ${error.message}`, { causeName: error.name }, { cause: error });
  }

  const childSeed = draft.seed >>> 0;
  const childIdentity = canonicalHash({
    version: LINEAGE_VERSION,
    parentRecipeHash,
    mutationSeed: config.mutationSeed,
    siblingIndex: config.siblingIndex,
    childSeed,
    operations
  });
  draft.lineage = {
    version: LINEAGE_VERSION,
    parentRecipeHash,
    childIdentity,
    mutationSeed: config.mutationSeed,
    siblingIndex: config.siblingIndex,
    childSeed,
    operations
  };

  let recipe;
  try {
    recipe = createRecipe(draft);
  } catch (error) {
    throw new MutationRejectedError('invalid-child', `Mutation produced an invalid child and was rejected: ${error.message}`, {
      parentRecipeHash,
      mutationSeed: config.mutationSeed,
      siblingIndex: config.siblingIndex,
      operations: cloneCanonical(operations)
    }, { cause: error });
  }

  return Object.freeze({
    version: MUTATION_VERSION,
    config,
    parentRecipeHash,
    childIdentity,
    childRecipeHash: recipeHash(recipe),
    recipe,
    operations: Object.freeze(operations),
    diff: diffRecipes(parent, recipe)
  });
}

export function createSiblingVariants(parentInput, input = {}) {
  const count = assertCount(input.count ?? 4, 'count', 1, 8);
  const baseConfig = normalizeMutationConfig(input);
  return Object.freeze(Array.from({ length: count }, (_, siblingIndex) => mutateRecipe(parentInput, {
    ...baseConfig,
    siblingIndex: (baseConfig.siblingIndex + siblingIndex) >>> 0
  })));
}
