import { FieldLayerCollection } from '../fields/index.js';
import { createLutAsset, createLutMapping } from '../lut/index.js';
import {
  DEFAULT_RECIPE_FRAMING,
  createRecipe,
  createRecipeReplay,
  parseRecipe,
  recipeHash,
  serializeRecipe
} from '../recipe/index.js';
import { LutEditorSession } from './lut-session.js';

export const RECIPE_EDITOR_VERSION = 'fw-editor-recipe-v1';
let activeRecipeEditorSession = null;

export function getActiveRecipeEditorSession() {
  return activeRecipeEditorSession;
}

function cloneFraming(framing) {
  return Object.freeze({ ...framing, center: Object.freeze({ ...framing.center }) });
}

export class RecipeEditorSession extends LutEditorSession {
  constructor(options = {}) {
    super(options);
    this._recipeFraming = options.framing ?? DEFAULT_RECIPE_FRAMING;
    this._recipeCommands = options.commands ?? [];
    this._recipeLineage = options.lineage ?? null;
    const normalized = createRecipe(this._recipeInput());
    this._recipeFraming = cloneFraming(normalized.framing);
    this._recipeCommands = normalized.commands;
    this._recipeLineage = normalized.lineage;
    this._touchAuthoring();
    this.resetSimulation();
    activeRecipeEditorSession = this;
  }

  _recipeInput() {
    return {
      seed: this.rootSeed,
      framing: this._recipeFraming ?? DEFAULT_RECIPE_FRAMING,
      fields: this.fieldCollection.toCanonical(),
      materials: this._materials,
      emitters: this._emitters,
      lut: this._lutAssets && this._lutMappings
        ? { assets: this._lutAssets, mappings: this._lutMappings }
        : { assets: [], mappings: [] },
      commands: this._recipeCommands ?? [],
      lineage: this._recipeLineage ?? null
    };
  }

  currentRecipe() {
    return createRecipe(this._recipeInput());
  }

  recipeHash() {
    return recipeHash(this._recipeInput());
  }

  authoringHash() {
    if (this._recipeCommands !== undefined && this._cachedAuthoringRevision === this._authoringRevision && this._cachedAuthoringHash) {
      return this._cachedAuthoringHash;
    }
    if (this._recipeCommands === undefined) return super.authoringHash();
    const hash = this.recipeHash();
    this._cachedAuthoringRevision = this._authoringRevision;
    this._cachedAuthoringHash = hash;
    return hash;
  }

  resetSimulation() {
    if (!this._lutAssets || this._recipeCommands === undefined) return super.resetSimulation();
    this.running = false;
    this._recipeReplay = createRecipeReplay(this._recipeInput(), {
      capacity: this.agentCapacity,
      maxDepositions: this.maxDepositions
    });
    this.simulation = this._recipeReplay.simulation;
    this.simulationRevision += 1;
    return this.simulation;
  }

  _adoptRecipeDefinitions(materials, emitters) {
    const simulation = super._adoptRecipeDefinitions(materials, emitters);
    if (this._recipeCommands !== undefined) return this.resetSimulation();
    return simulation;
  }

  runTicks(count) {
    if (!this._recipeReplay) return super.runTicks(count);
    return this._recipeReplay.runTicks(count);
  }

  singleStep() {
    this.pause();
    return this.runTicks(1);
  }

  multiStep(count = this.multiStepCount) {
    this.pause();
    return this.runTicks(count);
  }

  setCommandTimeline(commands) {
    const normalized = createRecipe({ ...this._recipeInput(), commands });
    this._recipeCommands = normalized.commands;
    this._touchAuthoring();
    this.resetSimulation();
    return this._recipeCommands;
  }

  addCommand(command) {
    return this.setCommandTimeline([...this._recipeCommands, command]);
  }

  removeCommand(id) {
    const candidate = this._recipeCommands.filter((command) => command.id !== id);
    if (candidate.length === this._recipeCommands.length) return false;
    this.setCommandTimeline(candidate);
    return true;
  }

  exportRecipeJson() {
    return serializeRecipe(this._recipeInput());
  }

  importRecipeJson(text) {
    return this.adoptRecipe(parseRecipe(text));
  }

  adoptRecipe(recipeInput) {
    const normalized = createRecipe(recipeInput);
    const candidateFields = FieldLayerCollection.fromCanonical(normalized.fields);
    const candidateAssets = normalized.lut.assets.map(createLutAsset);
    const candidateMappings = normalized.lut.mappings.map(createLutMapping);
    const candidateReplay = createRecipeReplay(normalized, {
      capacity: this.agentCapacity,
      maxDepositions: this.maxDepositions
    });

    this.rootSeed = normalized.seed;
    this.fieldCollection = candidateFields;
    this._materials = normalized.materials.map((material) => ({ ...material }));
    this._emitters = normalized.emitters.map((emitter) => ({
      ...emitter,
      bursts: emitter.bursts.map((burst) => ({ ...burst })),
      geometry: {
        ...emitter.geometry,
        origin: { ...emitter.geometry.origin },
        ...(Array.isArray(emitter.geometry.points) ? { points: emitter.geometry.points.map((point) => ({ ...point })) } : {})
      }
    }));
    this._lutAssets = candidateAssets;
    this._lutMappings = candidateMappings;
    this._recipeFraming = cloneFraming(normalized.framing);
    this._recipeCommands = normalized.commands;
    this._recipeLineage = normalized.lineage;
    this._recipeReplay = candidateReplay;
    this.simulation = candidateReplay.simulation;
    this.selectedFieldId = this.fieldCollection.order[0] ?? null;
    this.selectedEmitterId = this._emitters[0]?.id ?? null;
    this.selectedMaterialId = this._materials[0]?.id ?? null;
    this.selectedLutId = this._lutAssets[0]?.id ?? null;
    this.selectedLutChannel = this._lutAssets[0] ? Object.keys(this._lutAssets[0].channels)[0] : null;
    this.history.clear();
    this.running = false;
    this.simulationRevision += 1;
    this._touchAuthoring();
    activeRecipeEditorSession = this;
    return this.currentRecipe();
  }

  snapshot(backlogTicks = 0) {
    const base = super.snapshot(backlogTicks);
    return Object.freeze({
      ...base,
      recipeHash: this.authoringHash(),
      recipeFraming: this._recipeFraming,
      commandCount: this._recipeCommands.length,
      commands: Object.freeze(this._recipeCommands.map((command) => Object.freeze({ ...command }))),
      timelineFrozen: this._recipeReplay?.frozen ?? false
    });
  }
}
