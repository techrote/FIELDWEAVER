import { FieldLayerCollection, validateFieldOperatorLayer } from '../fields/index.js';
import { LutRegistry } from '../lut/index.js';
import { DeterministicAgentSimulation } from '../sim/index.js';
import { normalizeRecipe } from './public.js';

const UINT32_MAX = 0xffffffff;

function assertNonnegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new RangeError(`${label} must be an integer in [0, ${UINT32_MAX}].`);
  }
  return value;
}

function emitterInput(emitter) {
  const geometry = { ...emitter.geometry, origin: { ...emitter.geometry.origin } };
  if (Array.isArray(emitter.geometry.points)) geometry.points = emitter.geometry.points.map((point) => ({ ...point }));
  const { stopTick, ...rest } = emitter;
  return {
    ...rest,
    ...(stopTick === null || stopTick === undefined ? {} : { stopTick }),
    bursts: emitter.bursts.map((burst) => ({ ...burst })),
    geometry
  };
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
      emitters: this.recipe.emitters.map(emitterInput),
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
      emitters: this.simulation.emitters.map(emitterInput),
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
      emitters: candidate.map(emitterInput),
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
        const candidate = this.simulation.emitters.map((emitter) => {
          const cloned = emitterInput(emitter);
          if (emitter.id === command.emitterId) cloned.rate = command.rate;
          return cloned;
        });
        this._replaceEmitters(candidate);
        break;
      }
      case 'release-burst': {
        const candidate = this.simulation.emitters.map((emitter) => {
          const cloned = emitterInput(emitter);
          if (emitter.id !== command.emitterId) return cloned;
          const existing = cloned.bursts.find((burst) => burst.tick === command.tick)?.count ?? 0;
          const count = existing + command.count;
          if (count > 65535) throw new RangeError(`Command ${command.id} makes emitter ${command.emitterId} burst count exceed 65535.`);
          cloned.bursts = cloned.bursts.filter((burst) => burst.tick !== command.tick);
          cloned.bursts.push({ tick: command.tick, count });
          cloned.bursts.sort((a, b) => a.tick - b.tick);
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
    assertNonnegativeInteger(count, 'count');
    for (let index = 0; index < count; index += 1) this.step();
    return this.simulation.tick;
  }

  runToTick(targetTick) {
    const target = assertNonnegativeInteger(targetTick, 'targetTick');
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
