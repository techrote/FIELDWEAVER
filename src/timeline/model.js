import { canonicalStringify } from '../core/canonical.js';
import { Xoshiro128StarStar } from '../core/prng.js';
import { FieldLayerCollection, validateFieldOperatorLayer } from '../fields/index.js';
import { LutRegistry } from '../lut/index.js';
import { createRecipe, createRecipeReplay } from '../recipe/index.js';
import { DeterministicAgentSimulation } from '../sim/index.js';

export const TIMELINE_VERSION = 'fw-timeline-v1';
export const REPLAY_CHECKPOINT_VERSION = 'fw-replay-checkpoint-v1';
export const DEFAULT_CHECKPOINT_INTERVAL = 32;
export const DEFAULT_MAX_CHECKPOINTS = 12;

const UINT32_MAX = 0xffffffff;

function assertNonnegativeInteger(value, label, max = UINT32_MAX) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${label} must be an integer in [0, ${max}].`);
  }
  return value;
}

function assertPositiveInteger(value, label, max = UINT32_MAX) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${label} must be an integer in [1, ${max}].`);
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

function cloneDeposition(record) {
  return Object.freeze({
    ...record,
    from: Object.freeze({ ...record.from }),
    to: Object.freeze({ ...record.to }),
    ...(Array.isArray(record.colorRgba8) ? { colorRgba8: Object.freeze([...record.colorRgba8]) } : {})
  });
}

function commandFingerprint(command) {
  return canonicalStringify(command);
}

export function earliestChangedCommandTick(beforeCommands, afterCommands) {
  if (!Array.isArray(beforeCommands) || !Array.isArray(afterCommands)) throw new TypeError('Command timelines must be arrays.');
  const before = new Map(beforeCommands.map((command) => [command.id, command]));
  const after = new Map(afterCommands.map((command) => [command.id, command]));
  let earliest = null;
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const left = before.get(id);
    const right = after.get(id);
    if (left && right && commandFingerprint(left) === commandFingerprint(right)) continue;
    const tick = Math.min(left?.tick ?? UINT32_MAX, right?.tick ?? UINT32_MAX);
    earliest = earliest === null ? tick : Math.min(earliest, tick);
  }
  return earliest;
}

function checkpointByteEstimate(checkpoint) {
  const agentCount = checkpoint.state.agents.agents.length;
  const depositionCount = checkpoint.depositions.length;
  const fieldText = canonicalStringify(checkpoint.fields);
  const runtimeText = canonicalStringify({
    materials: checkpoint.materials,
    emitters: checkpoint.emitters,
    mappings: checkpoint.lutMappings,
    emitterState: checkpoint.state.emitters
  });
  return fieldText.length * 2 + runtimeText.length * 2 + agentCount * 52 + depositionCount * 120;
}

export function createReplayCheckpoint(replay) {
  if (!replay || !replay.simulation || !replay.fieldCollection) throw new TypeError('Replay checkpoint requires a RecipeReplay-like object.');
  const simulation = replay.simulation;
  const state = simulation.canonicalState();
  const checkpoint = {
    version: REPLAY_CHECKPOINT_VERSION,
    tick: simulation.tick,
    fields: replay.fieldCollection.toCanonical(),
    materials: Object.freeze(simulation.materials.map((material) => Object.freeze({ ...material }))),
    emitters: Object.freeze(simulation.emitters.map((emitter) => Object.freeze(emitterInput(emitter)))),
    lutMappings: Object.freeze(simulation.lutRegistry.mappings.map((mapping) => Object.freeze({ ...mapping }))),
    state,
    depositions: Object.freeze(simulation.depositions.map(cloneDeposition)),
    nextDepositionSequence: simulation.nextDepositionSequence,
    frozen: replay.frozen,
    nextCommandIndex: replay.nextCommandIndex,
    appliedCommandIds: Object.freeze([...replay.appliedCommandIds])
  };
  checkpoint.approxBytes = checkpointByteEstimate(checkpoint);
  return Object.freeze(checkpoint);
}

function restoreAgents(simulation, canonicalAgents) {
  const store = simulation.agents;
  for (const array of [
    store.active, store.emitterId, store.materialId, store.chunkX, store.chunkY,
    store.localX, store.localY, store.velocityXQ16, store.velocityYQ16,
    store.ageTicks, store.lifetimeTicks
  ]) array.fill(0);
  store.length = 0;
  for (const agent of canonicalAgents.agents) {
    if (agent.id < 1 || agent.id > store.capacity) throw new RangeError(`Checkpoint agent ID ${agent.id} exceeds replay capacity ${store.capacity}.`);
    const index = agent.id - 1;
    store.active[index] = 1;
    store.emitterId[index] = agent.emitterId;
    store.materialId[index] = agent.materialId;
    store.chunkX[index] = agent.position.chunkX;
    store.chunkY[index] = agent.position.chunkY;
    store.localX[index] = agent.position.localX;
    store.localY[index] = agent.position.localY;
    store.velocityXQ16[index] = agent.velocityXQ16;
    store.velocityYQ16[index] = agent.velocityYQ16;
    store.ageTicks[index] = agent.ageTicks;
    store.lifetimeTicks[index] = agent.lifetimeTicks;
    store.length += 1;
  }
  if (store.length !== canonicalAgents.length) throw new Error('Checkpoint agent length did not restore exactly.');
}

function restoreEmitterRuntime(simulation, emitterStates) {
  const byId = new Map(emitterStates.map((state) => [state.id, state]));
  for (const emitter of simulation.emitters) {
    const state = byId.get(emitter.id);
    if (!state) throw new RangeError(`Checkpoint lacks runtime state for emitter ${emitter.id}.`);
    simulation.emitterRuntime.set(emitter.id, {
      rng: new Xoshiro128StarStar([...state.rng]),
      spawnOrdinal: state.spawnOrdinal,
      spawned: state.spawned,
      dropped: state.dropped
    });
  }
}

function commandCursorAtTick(commands, tick) {
  let index = 0;
  while (index < commands.length && commands[index].tick < tick) index += 1;
  return index;
}

export function restoreReplayCheckpoint(recipeInput, checkpoint, options = {}) {
  if (!checkpoint || checkpoint.version !== REPLAY_CHECKPOINT_VERSION) throw new RangeError('Unsupported or missing replay checkpoint version.');
  const recipe = createRecipe(recipeInput);
  const fieldCollection = FieldLayerCollection.fromCanonical(checkpoint.fields);
  for (const layer of fieldCollection.orderedLayers()) validateFieldOperatorLayer(layer);
  const lutRegistry = new LutRegistry(recipe.lut.assets, checkpoint.lutMappings);
  const capacity = options.capacity ?? checkpoint.state.agents.capacity;
  const maxDepositions = options.maxDepositions ?? Math.max(1, checkpoint.depositions.length);
  const simulation = new DeterministicAgentSimulation({
    rootSeed: recipe.seed,
    materials: checkpoint.materials,
    emitters: checkpoint.emitters.map(emitterInput),
    fieldCollection,
    lutRegistry,
    capacity,
    maxDepositions
  });
  restoreAgents(simulation, checkpoint.state.agents);
  restoreEmitterRuntime(simulation, checkpoint.state.emitters);
  simulation.tick = checkpoint.state.tick;
  simulation.totalSpawned = checkpoint.state.totalSpawned;
  simulation.droppedSpawns = checkpoint.state.droppedSpawns;
  simulation.depositions = checkpoint.depositions.map(cloneDeposition);
  simulation.nextDepositionSequence = checkpoint.nextDepositionSequence;

  const replay = createRecipeReplay(recipe, { capacity, maxDepositions });
  replay.fieldCollection = fieldCollection;
  replay.simulation = simulation;
  replay.commands = recipe.commands;
  replay.nextCommandIndex = commandCursorAtTick(recipe.commands, checkpoint.tick);
  replay.frozen = checkpoint.frozen;
  replay.appliedCommandIds = recipe.commands.slice(0, replay.nextCommandIndex).map((command) => command.id);
  return replay;
}

export class TimelineReplayController {
  constructor(recipeInput, options = {}) {
    this.capacity = assertPositiveInteger(options.capacity ?? 8192, 'timeline.capacity', 1_000_000);
    this.maxDepositions = assertPositiveInteger(options.maxDepositions ?? 250_000, 'timeline.maxDepositions', 10_000_000);
    this.checkpointInterval = assertPositiveInteger(options.checkpointInterval ?? DEFAULT_CHECKPOINT_INTERVAL, 'timeline.checkpointInterval');
    this.maxCheckpoints = assertPositiveInteger(options.maxCheckpoints ?? DEFAULT_MAX_CHECKPOINTS, 'timeline.maxCheckpoints', 4096);
    this.evictions = 0;
    this.invalidations = 0;
    this.seekCount = 0;
    this.totalReplayTicks = 0;
    this.lastSeek = null;
    this.reset(recipeInput);
  }

  _freshReplay(recipe = this.recipe) {
    return createRecipeReplay(recipe, { capacity: this.capacity, maxDepositions: this.maxDepositions });
  }

  reset(recipeInput = this.recipe) {
    this.recipe = createRecipe(recipeInput);
    this.replay = this._freshReplay(this.recipe);
    this.checkpoints = new Map();
    this.checkpoints.set(0, createReplayCheckpoint(this.replay));
    this.lastSeek = Object.freeze({ startTick: 0, targetTick: 0, restoredTick: 0, replayedTicks: 0, usedCheckpoint: true });
    return this.replay;
  }

  _checkpointCurrent() {
    const tick = this.replay.simulation.tick;
    if (tick === 0 || tick % this.checkpointInterval !== 0 || this.checkpoints.has(tick)) return;
    this.checkpoints.set(tick, createReplayCheckpoint(this.replay));
    this._enforceCheckpointLimit();
  }

  _enforceCheckpointLimit() {
    while (this.checkpoints.size > this.maxCheckpoints) {
      const candidates = [...this.checkpoints.keys()].filter((tick) => tick !== 0).sort((a, b) => a - b);
      if (candidates.length === 0) break;
      this.checkpoints.delete(candidates[0]);
      this.evictions += 1;
    }
  }

  _runForward(count) {
    const ticks = assertNonnegativeInteger(count, 'timeline forward ticks');
    for (let index = 0; index < ticks; index += 1) {
      this.replay.step();
      this._checkpointCurrent();
    }
    return this.replay.simulation.tick;
  }

  runTicks(count) {
    return this._runForward(count);
  }

  runToTick(targetTick) {
    const target = assertNonnegativeInteger(targetTick, 'targetTick');
    if (target < this.replay.simulation.tick) return this.seek(target);
    return this._runForward(target - this.replay.simulation.tick);
  }

  _bestCheckpoint(targetTick) {
    let best = this.checkpoints.get(0);
    for (const [tick, checkpoint] of this.checkpoints) {
      if (tick <= targetTick && tick >= best.tick) best = checkpoint;
    }
    return best;
  }

  seek(targetTick) {
    const target = assertNonnegativeInteger(targetTick, 'targetTick');
    const startTick = this.replay.simulation.tick;
    if (target === startTick) return target;
    this.seekCount += 1;
    if (target > startTick) {
      const replayedTicks = target - startTick;
      this._runForward(replayedTicks);
      this.totalReplayTicks += replayedTicks;
      this.lastSeek = Object.freeze({ startTick, targetTick: target, restoredTick: startTick, replayedTicks, usedCheckpoint: false });
      return target;
    }

    const checkpoint = this._bestCheckpoint(target);
    this.replay = restoreReplayCheckpoint(this.recipe, checkpoint, {
      capacity: this.capacity,
      maxDepositions: this.maxDepositions
    });
    const replayedTicks = target - checkpoint.tick;
    this._runForward(replayedTicks);
    this.totalReplayTicks += replayedTicks;
    this.lastSeek = Object.freeze({ startTick, targetTick: target, restoredTick: checkpoint.tick, replayedTicks, usedCheckpoint: true });
    return target;
  }

  replaceCommands(commands, targetTick = this.replay.simulation.tick) {
    const nextRecipe = createRecipe({ ...this.recipe, commands });
    const earliest = earliestChangedCommandTick(this.recipe.commands, nextRecipe.commands);
    if (earliest === null) return this.seek(targetTick);
    let removed = 0;
    for (const tick of [...this.checkpoints.keys()]) {
      if (tick >= earliest && tick !== 0) {
        this.checkpoints.delete(tick);
        removed += 1;
      }
    }
    this.invalidations += removed;
    this.recipe = nextRecipe;
    const target = assertNonnegativeInteger(targetTick, 'targetTick');
    const checkpoint = this._bestCheckpoint(target);
    this.replay = restoreReplayCheckpoint(this.recipe, checkpoint, {
      capacity: this.capacity,
      maxDepositions: this.maxDepositions
    });
    const replayedTicks = target - checkpoint.tick;
    this._runForward(replayedTicks);
    this.totalReplayTicks += replayedTicks;
    this.lastSeek = Object.freeze({ startTick: target, targetTick: target, restoredTick: checkpoint.tick, replayedTicks, usedCheckpoint: true, afterTimelineEdit: true });
    return Object.freeze({ earliestAffectedTick: earliest, invalidated: removed, targetTick: target });
  }

  replaceRecipe(recipeInput, targetTick = 0) {
    if (this.checkpoints) this.invalidations += this.checkpoints.size;
    this.reset(recipeInput);
    return this.runToTick(targetTick);
  }

  diagnostics() {
    const checkpoints = [...this.checkpoints.values()].sort((a, b) => a.tick - b.tick);
    return Object.freeze({
      version: TIMELINE_VERSION,
      checkpointInterval: this.checkpointInterval,
      checkpointCount: checkpoints.length,
      maxCheckpoints: this.maxCheckpoints,
      checkpointTicks: Object.freeze(checkpoints.map((checkpoint) => checkpoint.tick)),
      checkpointBytes: checkpoints.reduce((total, checkpoint) => total + checkpoint.approxBytes, 0),
      evictions: this.evictions,
      invalidations: this.invalidations,
      seekCount: this.seekCount,
      totalReplayTicks: this.totalReplayTicks,
      lastSeek: this.lastSeek
    });
  }
}
