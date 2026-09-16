import { canonicalHash, canonicalStringify } from '../core/canonical.js';
import { INT32_MAX, Q16_ONE, UINT32_MAX, assertInt32, assertUint32 } from '../core/numeric.js';
import { normalizeWorldPosition } from '../core/coordinates.js';
import { FieldLayerCollection, validateFieldOperatorLayer } from '../fields/index.js';
import { LutRegistry, LUT_DESTINATIONS, createLutMapping } from '../lut/index.js';
import {
  DeterministicAgentSimulation,
  MAX_MATERIAL_INTERACTION_RADIUS_Q16,
  SIMULATION_VERSION
} from '../sim/index.js';

export const RECIPE_SCHEMA_VERSION = 'fw-recipe-v1';
export const COMMAND_SCHEMA_VERSION = 'fw-command-v1';
export const RECIPE_MIGRATION_VERSION = 'fw-recipe-migrations-v1';
export const COMMAND_TYPES = Object.freeze([
  'set-material-parameter',
  'set-field-enabled',
  'set-emitter-rate',
  'release-burst',
  'set-simulation-frozen',
  'set-lut-mapping'
]);
export const MATERIAL_COMMAND_PARAMETERS = Object.freeze([
  'inertiaNumerator',
  'inertiaDenominator',
  'steeringNumerator',
  'steeringDenominator',
  'lifetimeTicks',
  'depositEvery',
  'radiusQ16',
  'strengthQ16'
]);
export const DEFAULT_RECIPE_FRAMING = Object.freeze({
  widthPx: 1920,
  heightPx: 1080,
  center: Object.freeze({ chunkX: 0, chunkY: 0, localX: 128 * Q16_ONE, localY: 128 * Q16_ONE }),
  unitsPerPixelQ16: Math.round(Q16_ONE / 4)
});

const TOP_LEVEL_KEYS = Object.freeze([
  'schemaVersion', 'engineVersion', 'seed', 'framing', 'fields', 'materials', 'emitters', 'lut', 'commands', 'lineage'
]);
const MAX_FRAME_DIMENSION = 100_000;
const migrations = new Map();

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object.`);
  return value;
}

function assertOnlyKeys(value, allowed, label) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new RangeError(`${label} contains unsupported property ${key}.`);
  }
}

function assertPositiveInteger(value, label, max = INT32_MAX) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${label} must be an integer in [1, ${max}].`);
  }
  return value;
}

function assertNonnegativeInteger(value, label, max = INT32_MAX) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${label} must be an integer in [0, ${max}].`);
  }
  return value;
}

function cloneCanonical(value) {
  return JSON.parse(canonicalStringify(value));
}

function cloneMaterial(material) {
  return Object.freeze({ ...material });
}

function cloneEmitter(emitter) {
  const geometry = { ...emitter.geometry, origin: { ...emitter.geometry.origin } };
  if (Array.isArray(emitter.geometry.points)) geometry.points = emitter.geometry.points.map((point) => ({ ...point }));
  return Object.freeze({
    ...emitter,
    bursts: emitter.bursts.map((burst) => ({ ...burst })),
    geometry: Object.freeze(geometry)
  });
}

function normalizeFraming(input = DEFAULT_RECIPE_FRAMING) {
  const framing = assertPlainObject(input, 'recipe.framing');
  assertOnlyKeys(framing, ['widthPx', 'heightPx', 'center', 'unitsPerPixelQ16'], 'recipe.framing');
  return Object.freeze({
    widthPx: assertPositiveInteger(framing.widthPx, 'recipe.framing.widthPx', MAX_FRAME_DIMENSION),
    heightPx: assertPositiveInteger(framing.heightPx, 'recipe.framing.heightPx', MAX_FRAME_DIMENSION),
    center: Object.freeze({ ...normalizeWorldPosition(framing.center) }),
    unitsPerPixelQ16: assertPositiveInteger(framing.unitsPerPixelQ16, 'recipe.framing.unitsPerPixelQ16', INT32_MAX)
  });
}

function normalizeLineage(input) {
  if (input === undefined || input === null) return null;
  const lineage = assertPlainObject(input, 'recipe.lineage');
  assertOnlyKeys(lineage, ['parentRecipeHash', 'childSeed', 'operations'], 'recipe.lineage');
  if (typeof lineage.parentRecipeHash !== 'string' || !/^[0-9a-f]{16}$/.test(lineage.parentRecipeHash)) {
    throw new RangeError('recipe.lineage.parentRecipeHash must be a 16-character lowercase canonical hash.');
  }
  const operations = lineage.operations ?? [];
  if (!Array.isArray(operations)) throw new TypeError('recipe.lineage.operations must be an array.');
  for (let index = 0; index < operations.length; index += 1) {
    assertPlainObject(operations[index], `recipe.lineage.operations[${index}]`);
  }
  return Object.freeze({
    parentRecipeHash: lineage.parentRecipeHash,
    childSeed: assertUint32(lineage.childSeed ?? 0, 'recipe.lineage.childSeed'),
    operations: Object.freeze(operations.map((operation) => Object.freeze(cloneCanonical(operation))))
  });
}

function validateFieldCollection(input) {
  const fields = FieldLayerCollection.fromCanonical(input);
  for (const layer of fields.orderedLayers()) validateFieldOperatorLayer(layer);
  return fields;
}

function validateMaterialCommandValue(parameter, value) {
  if (!MATERIAL_COMMAND_PARAMETERS.includes(parameter)) {
    throw new RangeError(`Unsupported material command parameter: ${String(parameter)}.`);
  }
  switch (parameter) {
    case 'inertiaNumerator':
    case 'inertiaDenominator':
    case 'steeringDenominator':
    case 'lifetimeTicks':
    case 'depositEvery':
      return assertPositiveInteger(value, `command.${parameter}`, UINT32_MAX);
    case 'steeringNumerator':
    case 'strengthQ16':
      return assertNonnegativeInteger(value, `command.${parameter}`, INT32_MAX);
    case 'radiusQ16':
      return assertPositiveInteger(value, 'command.radiusQ16', MAX_MATERIAL_INTERACTION_RADIUS_Q16);
    default:
      throw new RangeError(`Unsupported material command parameter: ${parameter}.`);
  }
}

function commandBase(input, index) {
  const command = assertPlainObject(input, `recipe.commands[${index}]`);
  const version = command.version ?? COMMAND_SCHEMA_VERSION;
  if (version !== COMMAND_SCHEMA_VERSION) {
    throw new RangeError(`Unsupported command schema version: ${String(version)}.`);
  }
  const id = assertUint32(command.id, `recipe.commands[${index}].id`);
  if (id === 0) throw new RangeError('Command ID 0 is reserved.');
  const tick = assertNonnegativeInteger(command.tick, `recipe.commands[${index}].tick`, UINT32_MAX);
  const type = command.type;
  if (!COMMAND_TYPES.includes(type)) throw new RangeError(`Unsupported command type: ${String(type)}.`);
  return { command, version, id, tick, type };
}

function normalizeCommands(commands, context) {
  if (!Array.isArray(commands)) throw new TypeError('recipe.commands must be an array.');
  const materialIds = new Set(context.materials.map((material) => material.id));
  const emitterIds = new Set(context.emitters.map((emitter) => emitter.id));
  const fieldIds = new Set(context.fields.order);
  const lutIds = new Set(context.lut.assets.map((asset) => asset.id));
  const normalized = commands.map((input, index) => {
    const base = commandBase(input, index);
    const { command, version, id, tick, type } = base;
    switch (type) {
      case 'set-material-parameter': {
        assertOnlyKeys(command, ['version', 'id', 'tick', 'type', 'materialId', 'parameter', 'value'], `recipe.commands[${index}]`);
        const materialId = assertUint32(command.materialId, `recipe.commands[${index}].materialId`);
        if (!materialIds.has(materialId)) throw new RangeError(`Command ${id} references unknown material ${materialId}.`);
        if (typeof command.parameter !== 'string') throw new TypeError(`recipe.commands[${index}].parameter must be a string.`);
        return Object.freeze({ version, id, tick, type, materialId, parameter: command.parameter, value: validateMaterialCommandValue(command.parameter, command.value) });
      }
      case 'set-field-enabled': {
        assertOnlyKeys(command, ['version', 'id', 'tick', 'type', 'fieldId', 'enabled'], `recipe.commands[${index}]`);
        const fieldId = assertUint32(command.fieldId, `recipe.commands[${index}].fieldId`);
        if (!fieldIds.has(fieldId)) throw new RangeError(`Command ${id} references unknown field ${fieldId}.`);
        if (typeof command.enabled !== 'boolean') throw new TypeError(`recipe.commands[${index}].enabled must be boolean.`);
        return Object.freeze({ version, id, tick, type, fieldId, enabled: command.enabled });
      }
      case 'set-emitter-rate': {
        assertOnlyKeys(command, ['version', 'id', 'tick', 'type', 'emitterId', 'rate'], `recipe.commands[${index}]`);
        const emitterId = assertUint32(command.emitterId, `recipe.commands[${index}].emitterId`);
        if (!emitterIds.has(emitterId)) throw new RangeError(`Command ${id} references unknown emitter ${emitterId}.`);
        return Object.freeze({ version, id, tick, type, emitterId, rate: assertNonnegativeInteger(command.rate, `recipe.commands[${index}].rate`, 65535) });
      }
      case 'release-burst': {
        assertOnlyKeys(command, ['version', 'id', 'tick', 'type', 'emitterId', 'count'], `recipe.commands[${index}]`);
        const emitterId = assertUint32(command.emitterId, `recipe.commands[${index}].emitterId`);
        if (!emitterIds.has(emitterId)) throw new RangeError(`Command ${id} references unknown emitter ${emitterId}.`);
        return Object.freeze({ version, id, tick, type, emitterId, count: assertPositiveInteger(command.count, `recipe.commands[${index}].count`, 65535) });
      }
      case 'set-simulation-frozen': {
        assertOnlyKeys(command, ['version', 'id', 'tick', 'type', 'frozen'], `recipe.commands[${index}]`);
        if (typeof command.frozen !== 'boolean') throw new TypeError(`recipe.commands[${index}].frozen must be boolean.`);
        return Object.freeze({ version, id, tick, type, frozen: command.frozen });
      }
      case 'set-lut-mapping': {
        assertOnlyKeys(command, ['version', 'id', 'tick', 'type', 'materialId', 'destination', 'mapping'], `recipe.commands[${index}]`);
        const materialId = assertUint32(command.materialId, `recipe.commands[${index}].materialId`);
        if (!materialIds.has(materialId)) throw new RangeError(`Command ${id} references unknown material ${materialId}.`);
        if (!LUT_DESTINATIONS.includes(command.destination)) throw new RangeError(`Command ${id} has unsupported LUT destination ${String(command.destination)}.`);
        if (command.mapping === null) return Object.freeze({ version, id, tick, type, materialId, destination: command.destination, mapping: null });
        const mapping = createLutMapping(command.mapping);
        if (mapping.materialId !== materialId || mapping.destination !== command.destination) {
          throw new RangeError(`Command ${id} mapping material/destination must match the command target.`);
        }
        if (!lutIds.has(mapping.lutId)) throw new RangeError(`Command ${id} mapping references unknown LUT ${mapping.lutId}.`);
        new LutRegistry(context.lut.assets, [mapping]);
        return Object.freeze({ version, id, tick, type, materialId, destination: command.destination, mapping: Object.freeze({ ...mapping }) });
      }
      default:
        throw new RangeError(`Unsupported command type: ${type}.`);
    }
  });

  normalized.sort((a, b) => (a.tick - b.tick) || (a.id - b.id));
  const ids = new Set();
  for (const command of normalized) {
    if (ids.has(command.id)) throw new RangeError(`Duplicate command ID ${command.id}.`);
    ids.add(command.id);
  }
  return Object.freeze(normalized);
}

function normalizedRecipeObject(input) {
  const recipe = assertPlainObject(input, 'recipe');
  assertOnlyKeys(recipe, TOP_LEVEL_KEYS, 'recipe');
  if (recipe.schemaVersion !== RECIPE_SCHEMA_VERSION) {
    throw new RangeError(`Unsupported recipe schema version: ${String(recipe.schemaVersion)}.`);
  }
  if (recipe.engineVersion !== SIMULATION_VERSION) {
    throw new RangeError(`Unsupported recipe engine version: ${String(recipe.engineVersion)}; expected ${SIMULATION_VERSION}.`);
  }
  const seed = assertUint32(recipe.seed, 'recipe.seed');
  const framing = normalizeFraming(recipe.framing);
  const fieldCollection = validateFieldCollection(recipe.fields);
  const lutInput = assertPlainObject(recipe.lut, 'recipe.lut');
  assertOnlyKeys(lutInput, ['schemaVersion', 'assets', 'mappings'], 'recipe.lut');
  const lutRegistry = new LutRegistry(lutInput.assets, lutInput.mappings);
  const probe = new DeterministicAgentSimulation({
    rootSeed: seed,
    materials: recipe.materials,
    emitters: recipe.emitters,
    fieldCollection,
    lutRegistry,
    capacity: 1,
    maxDepositions: 1
  });
  for (const mapping of lutRegistry.mappings) {
    if (!probe.materialById.has(mapping.materialId)) throw new RangeError(`LUT mapping ${mapping.id} references unknown material ${mapping.materialId}.`);
  }
  const fields = fieldCollection.toCanonical();
  const materials = Object.freeze(probe.materials.map(cloneMaterial));
  const emitters = Object.freeze(probe.emitters.map(cloneEmitter));
  const lut = Object.freeze(lutRegistry.toCanonical());
  const commands = normalizeCommands(recipe.commands ?? [], { fields, materials, emitters, lut });
  const lineage = normalizeLineage(recipe.lineage);
  return Object.freeze({
    schemaVersion: RECIPE_SCHEMA_VERSION,
    engineVersion: SIMULATION_VERSION,
    seed,
    framing,
    fields,
    materials,
    emitters,
    lut,
    commands,
    lineage
  });
}

export function registerRecipeMigration(fromVersion, migrate) {
  if (typeof fromVersion !== 'string' || fromVersion.length === 0) throw new TypeError('fromVersion must be a non-empty string.');
  if (fromVersion === RECIPE_SCHEMA_VERSION) throw new RangeError('Current recipe schema cannot be registered as a migration source.');
  if (typeof migrate !== 'function') throw new TypeError('Recipe migration must be a function.');
  if (migrations.has(fromVersion)) throw new RangeError(`Migration from ${fromVersion} is already registered.`);
  migrations.set(fromVersion, migrate);
}

export function migrateRecipe(input) {
  let current = assertPlainObject(input, 'recipe');
  const visited = new Set();
  while (current.schemaVersion !== RECIPE_SCHEMA_VERSION) {
    const version = current.schemaVersion;
    if (typeof version !== 'string' || version.length === 0) throw new RangeError('Recipe schemaVersion is required.');
    if (visited.has(version)) throw new RangeError(`Recipe migration cycle detected at ${version}.`);
    visited.add(version);
    const migration = migrations.get(version);
    if (!migration) {
      throw new RangeError(`Unsupported recipe schema version: ${version}; no explicit migration is registered.`);
    }
    current = assertPlainObject(migration(cloneCanonical(current)), `migration result from ${version}`);
  }
  return current;
}

export function normalizeRecipe(input) {
  return normalizedRecipeObject(migrateRecipe(input));
}

export function createRecipe(input) {
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
  const normalized = normalizeRecipe(input);
  return `${JSON.stringify(normalized, null, 2)}\n`;
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

function validateRuntimeMappings(registry, materialById) {
  for (const mapping of registry.mappings) {
    if (!materialById.has(mapping.materialId)) throw new RangeError(`LUT mapping ${mapping.id} references unknown material ${mapping.materialId}.`);
  }
}

export class RecipeReplay {
  constructor(recipeInput, options = {}) {
    this.recipe = normalizeRecipe(recipeInput);
    this.fieldCollection = FieldLayerCollection.fromCanonical(this.recipe.fields);
    for (const layer of this.fieldCollection.orderedLayers()) validateFieldOperatorLayer(layer);
    this.simulation = new DeterministicAgentSimulation({
      rootSeed: this.recipe.seed,
      materials: this.recipe.materials,
      emitters: this.recipe.emitters,
      fieldCollection: this.fieldCollection,
      lutAssets: this.recipe.lut.assets,
      lutMappings: this.recipe.lut.mappings,
      capacity: options.capacity ?? 8192,
      maxDepositions: options.maxDepositions ?? 250_000
    });
    this.commands = this.recipe.commands;
    this.nextCommandIndex = 0;
    this.frozen = false;
    this.appliedCommandIds = [];
  }

  _replaceMaterials(candidate) {
    const probe = new DeterministicAgentSimulation({
      rootSeed: this.recipe.seed,
      materials: candidate,
      emitters: this.simulation.emitters,
      fieldCollection: this.fieldCollection,
      lutRegistry: this.simulation.lutRegistry,
      capacity: 1,
      maxDepositions: 1
    });
    this.simulation.materials = probe.materials;
    this.simulation.materialById = new Map(probe.materials.map((material) => [material.id, material]));
    validateRuntimeMappings(this.simulation.lutRegistry, this.simulation.materialById);
  }

  _replaceEmitters(candidate) {
    const probe = new DeterministicAgentSimulation({
      rootSeed: this.recipe.seed,
      materials: this.simulation.materials,
      emitters: candidate,
      fieldCollection: this.fieldCollection,
      lutRegistry: this.simulation.lutRegistry,
      capacity: 1,
      maxDepositions: 1
    });
    this.simulation.emitters = probe.emitters;
  }

  _applyCommand(command) {
    switch (command.type) {
      case 'set-material-parameter': {
        const candidate = this.simulation.materials.map((material) => material.id === command.materialId
          ? { ...material, [command.parameter]: command.value }
          : { ...material });
        this._replaceMaterials(candidate);
        break;
      }
      case 'set-field-enabled':
        this.fieldCollection.setEnabled(command.fieldId, command.enabled);
        break;
      case 'set-emitter-rate': {
        const candidate = this.simulation.emitters.map((emitter) => emitter.id === command.emitterId
          ? { ...emitter, rate: command.rate, bursts: emitter.bursts.map((burst) => ({ ...burst })), geometry: cloneCanonical(emitter.geometry) }
          : cloneCanonical(emitter));
        this._replaceEmitters(candidate);
        break;
      }
      case 'release-burst': {
        const candidate = this.simulation.emitters.map((emitter) => {
          const cloned = cloneCanonical(emitter);
          if (emitter.id !== command.emitterId) return cloned;
          const bursts = cloned.bursts.filter((burst) => burst.tick !== command.tick);
          const existing = cloned.bursts.find((burst) => burst.tick === command.tick)?.count ?? 0;
          const count = existing + command.count;
          if (count > 65535) throw new RangeError(`Command ${command.id} makes emitter ${command.emitterId} burst count exceed 65535.`);
          bursts.push({ tick: command.tick, count });
          bursts.sort((a, b) => a.tick - b.tick);
          cloned.bursts = bursts;
          return cloned;
        });
        this._replaceEmitters(candidate);
        break;
      }
      case 'set-simulation-frozen':
        this.frozen = command.frozen;
        break;
      case 'set-lut-mapping': {
        const mappings = this.simulation.lutRegistry.mappings
          .filter((mapping) => !(mapping.materialId === command.materialId && mapping.destination === command.destination))
          .map((mapping) => ({ ...mapping }));
        if (command.mapping !== null) mappings.push({ ...command.mapping });
        const registry = new LutRegistry(this.simulation.lutRegistry.assets, mappings);
        validateRuntimeMappings(registry, this.simulation.materialById);
        this.simulation.lutRegistry = registry;
        break;
      }
      default:
        throw new RangeError(`Unsupported command type: ${command.type}.`);
    }
    this.appliedCommandIds.push(command.id);
  }

  applyCommandsAtCurrentTick() {
    while (this.nextCommandIndex < this.commands.length && this.commands[this.nextCommandIndex].tick === this.simulation.tick) {
      this._applyCommand(this.commands[this.nextCommandIndex]);
      this.nextCommandIndex += 1;
    }
  }

  step() {
    this.applyCommandsAtCurrentTick();
    if (this.frozen) this.simulation.tick += 1;
    else this.simulation.step();
    return this.simulation.tick;
  }

  runTicks(count) {
    assertNonnegativeInteger(count, 'count', UINT32_MAX);
    for (let index = 0; index < count; index += 1) this.step();
    return this.simulation.tick;
  }

  runToTick(targetTick) {
    const target = assertNonnegativeInteger(targetTick, 'targetTick', UINT32_MAX);
    if (target < this.simulation.tick) throw new RangeError('RecipeReplay cannot run backward; create a fresh replay for an earlier tick.');
    return this.runTicks(target - this.simulation.tick);
  }

  stateHash() { return this.simulation.stateHash(); }
  depositionHash() { return this.simulation.depositionHash(); }
  resultHash() { return this.simulation.resultHash(); }
}

export function createRecipeReplay(recipe, options = {}) {
  return new RecipeReplay(recipe, options);
}

export function replayRecipeToTick(recipe, targetTick, options = {}) {
  const replay = new RecipeReplay(recipe, options);
  replay.runToTick(targetTick);
  return replay;
}
