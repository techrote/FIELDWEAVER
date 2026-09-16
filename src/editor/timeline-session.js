import { canonicalStringify } from '../core/canonical.js';
import { COMMAND_TYPES, createRecipe, recipeHash } from '../recipe/index.js';
import { TimelineReplayController } from '../timeline/index.js';
import { RecipeEditorSession } from './recipe-session.js';

export const TIMELINE_EDITOR_VERSION = 'fw-editor-timeline-v1';
export const DEFAULT_TIMELINE_HISTORY_ENTRIES = 64;

function cloneCommands(commands) {
  return commands.map((command) => JSON.parse(canonicalStringify(command)));
}

function assertHistoryLimit(value) {
  if (!Number.isInteger(value) || value < 1 || value > 4096) throw new RangeError('timelineHistoryEntries must be an integer in [1, 4096].');
  return value;
}

function commandIdSet(commands) {
  return new Set(commands.map((command) => command.id));
}

export class TimelineEditHistory {
  constructor(limit = DEFAULT_TIMELINE_HISTORY_ENTRIES) {
    this.limit = assertHistoryLimit(limit);
    this.undoStack = [];
    this.redoStack = [];
  }

  get undoDepth() { return this.undoStack.length; }
  get redoDepth() { return this.redoStack.length; }

  push(entry) {
    this.undoStack.push(Object.freeze({
      label: entry.label,
      before: Object.freeze(cloneCommands(entry.before)),
      after: Object.freeze(cloneCommands(entry.after))
    }));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  takeUndo() {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    return entry;
  }

  takeRedo() {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return entry;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

export class TimelineEditorSession extends RecipeEditorSession {
  constructor(options = {}) {
    super(options);
    this.timelineHistory = new TimelineEditHistory(options.timelineHistoryEntries ?? DEFAULT_TIMELINE_HISTORY_ENTRIES);
    this._timelineController = new TimelineReplayController(this.currentRecipe(), {
      capacity: this.agentCapacity,
      maxDepositions: this.maxDepositions,
      checkpointInterval: options.checkpointInterval,
      maxCheckpoints: options.maxCheckpoints
    });
    this._adoptTimelineReplay();
  }

  _adoptTimelineReplay() {
    if (!this._timelineController) return;
    this._recipeReplay = this._timelineController.replay;
    this.simulation = this._timelineController.replay.simulation;
  }

  resetSimulation() {
    if (!this._timelineController) return super.resetSimulation();
    this.running = false;
    const currentRecipe = this.currentRecipe();
    if (recipeHash(currentRecipe) === recipeHash(this._timelineController.recipe)) {
      this._timelineController.seek(0);
    } else {
      this._timelineController.replaceRecipe(currentRecipe, 0);
    }
    this._adoptTimelineReplay();
    this.simulationRevision += 1;
    return this.simulation;
  }

  runTicks(count) {
    if (!this._timelineController) return super.runTicks(count);
    const tick = this._timelineController.runTicks(count);
    this._adoptTimelineReplay();
    return tick;
  }

  seekTimeline(targetTick) {
    this.pause();
    const tick = this._timelineController.seek(targetTick);
    this._adoptTimelineReplay();
    this.simulationRevision += 1;
    return tick;
  }

  _replaceTimelineCommands(commands) {
    const currentTick = this.simulation.tick;
    const normalized = createRecipe({ ...this._recipeInput(), commands });
    this._recipeCommands = normalized.commands;
    this._touchAuthoring();
    const result = this._timelineController.replaceCommands(this._recipeCommands, currentTick);
    this._adoptTimelineReplay();
    this.simulationRevision += 1;
    return result;
  }

  setCommandTimeline(commands) {
    if (!this._timelineController) return super.setCommandTimeline(commands);
    return this._replaceTimelineCommands(commands);
  }

  applyTimelineCommands(commands, label = 'timeline edit') {
    const before = cloneCommands(this._recipeCommands);
    const normalized = createRecipe({ ...this._recipeInput(), commands }).commands;
    if (canonicalStringify(before) === canonicalStringify(normalized)) return false;
    this._replaceTimelineCommands(normalized);
    this.timelineHistory.push({ label, before, after: normalized });
    return true;
  }

  nextCommandId() {
    const ids = commandIdSet(this._recipeCommands);
    for (let id = 1; id <= 0xffffffff; id += 1) if (!ids.has(id)) return id;
    throw new RangeError('Command ID space is exhausted.');
  }

  draftTimelineCommand(type, tick = this.simulation.tick) {
    if (!COMMAND_TYPES.includes(type)) throw new RangeError(`Unsupported command type: ${String(type)}.`);
    const id = this.nextCommandId();
    const selectedMaterial = this._materials.find((material) => material.id === this.selectedMaterialId) ?? this._materials[0];
    const selectedEmitter = this._emitters.find((emitter) => emitter.id === this.selectedEmitterId) ?? this._emitters[0];
    const selectedFieldId = this.selectedFieldId ?? this.fieldCollection.order[0];
    switch (type) {
      case 'set-material-parameter':
        return { id, tick, type, materialId: selectedMaterial.id, parameter: 'steeringNumerator', value: selectedMaterial.steeringNumerator };
      case 'set-field-enabled':
        return { id, tick, type, fieldId: selectedFieldId, enabled: false };
      case 'set-emitter-rate':
        return { id, tick, type, emitterId: selectedEmitter.id, rate: selectedEmitter.rate };
      case 'release-burst':
        return { id, tick, type, emitterId: selectedEmitter.id, count: 4 };
      case 'set-simulation-frozen':
        return { id, tick, type, frozen: true };
      case 'set-lut-mapping': {
        const existing = this._lutMappings.find((mapping) => mapping.materialId === selectedMaterial.id && mapping.destination === 'color') ?? null;
        return { id, tick, type, materialId: selectedMaterial.id, destination: 'color', mapping: existing === null ? null : { ...existing } };
      }
      default:
        throw new RangeError(`Unsupported command type: ${type}.`);
    }
  }

  addTimelineCommand(command) {
    return this.applyTimelineCommands([...this._recipeCommands, command], `add command #${command.id}`);
  }

  updateTimelineCommand(id, replacement) {
    if (!this._recipeCommands.some((command) => command.id === id)) throw new RangeError(`Unknown command ID ${id}.`);
    const next = this._recipeCommands.map((command) => command.id === id ? replacement : command);
    return this.applyTimelineCommands(next, `edit command #${id}`);
  }

  removeTimelineCommand(id) {
    const next = this._recipeCommands.filter((command) => command.id !== id);
    if (next.length === this._recipeCommands.length) return false;
    return this.applyTimelineCommands(next, `remove command #${id}`);
  }

  moveSameTickCommand(id, delta) {
    if (delta !== -1 && delta !== 1) throw new RangeError('Same-tick command move delta must be -1 or 1.');
    const command = this._recipeCommands.find((entry) => entry.id === id);
    if (!command) throw new RangeError(`Unknown command ID ${id}.`);
    const sameTick = this._recipeCommands.filter((entry) => entry.tick === command.tick);
    const index = sameTick.findIndex((entry) => entry.id === id);
    const other = sameTick[index + delta];
    if (!other) return id;
    const next = this._recipeCommands.map((entry) => {
      if (entry.id === command.id) return { ...entry, id: other.id };
      if (entry.id === other.id) return { ...entry, id: command.id };
      return entry;
    });
    this.applyTimelineCommands(next, `reorder tick ${command.tick}`);
    return other.id;
  }

  undoTimeline() {
    const entry = this.timelineHistory.takeUndo();
    if (!entry) return false;
    try {
      this._replaceTimelineCommands(entry.before);
      return true;
    } catch (error) {
      this.timelineHistory.takeRedo();
      throw error;
    }
  }

  redoTimeline() {
    const entry = this.timelineHistory.takeRedo();
    if (!entry) return false;
    try {
      this._replaceTimelineCommands(entry.after);
      return true;
    } catch (error) {
      this.timelineHistory.takeUndo();
      throw error;
    }
  }

  adoptRecipe(recipeInput) {
    const result = super.adoptRecipe(recipeInput);
    if (this._timelineController) {
      this._timelineController.replaceRecipe(this.currentRecipe(), 0);
      this._adoptTimelineReplay();
      this.timelineHistory?.clear();
    }
    return result;
  }

  snapshot(backlogTicks = 0) {
    const base = super.snapshot(backlogTicks);
    const diagnostics = this._timelineController?.diagnostics() ?? null;
    return Object.freeze({
      ...base,
      timelineVersion: TIMELINE_EDITOR_VERSION,
      playheadTick: this.simulation.tick,
      timelineHistory: Object.freeze({
        undoDepth: this.timelineHistory?.undoDepth ?? 0,
        redoDepth: this.timelineHistory?.redoDepth ?? 0
      }),
      timelineDiagnostics: diagnostics
    });
  }
}
