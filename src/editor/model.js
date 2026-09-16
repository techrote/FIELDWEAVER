import { canonicalHash } from '../core/canonical.js';
import { CHUNK_SPAN_Q16, normalizeWorldPosition } from '../core/coordinates.js';
import { Q16_ONE, UINT32_MAX, assertInt32, assertUint32 } from '../core/numeric.js';
import {
  AuthoringHistory,
  FieldLayerCollection,
  SparseFieldLayer,
  createBrushCommand,
  createLayerEnabledCommand,
  createLayerMoveCommand,
  fieldCellToGlobalGrid,
  worldPositionToFieldCell,
  validateFieldOperatorLayer
} from '../fields/index.js';
import {
  DeterministicAgentSimulation,
  MATERIAL_KINDS,
  MAX_MATERIAL_INTERACTION_RADIUS_Q16,
  createBaselineMaterials
} from '../sim/index.js';

export const EDITOR_VERSION = 'fw-editor-v1';
export const DEFAULT_EDITOR_SEED = 0x46d2a71b;
export const EDITOR_TOOLS = Object.freeze([
  'pan',
  'paint',
  'erase',
  'move-field',
  'place-emitter',
  'move-emitter'
]);
export const EDITOR_SPEEDS = Object.freeze([0.25, 0.5, 1, 2, 4, 8]);

const DEFAULT_AGENT_CAPACITY = 8192;
const DEFAULT_MAX_DEPOSITIONS = 250_000;
const DEFAULT_HISTORY_ENTRIES = 128;

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
  return value;
}

function assertPositiveInteger(value, label, max = 1_000_000) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${label} must be an integer in [1, ${max}].`);
  }
  return value;
}

function clonePosition(position) {
  return Object.freeze({ ...normalizeWorldPosition(position) });
}

export function worldPositionFromUnits(x, y) {
  assertFiniteNumber(x, 'x');
  assertFiniteNumber(y, 'y');
  const localX = Math.round(x * Q16_ONE);
  const localY = Math.round(y * Q16_ONE);
  if (!Number.isSafeInteger(localX) || !Number.isSafeInteger(localY)) {
    throw new RangeError('Editor world position exceeds safe conversion range.');
  }
  return normalizeWorldPosition({ chunkX: 0, chunkY: 0, localX, localY });
}

export function worldPositionToUnits(position) {
  const normalized = normalizeWorldPosition(position);
  const xQ16 = BigInt(normalized.chunkX) * BigInt(CHUNK_SPAN_Q16) + BigInt(normalized.localX);
  const yQ16 = BigInt(normalized.chunkY) * BigInt(CHUNK_SPAN_Q16) + BigInt(normalized.localY);
  return Object.freeze({ x: Number(xQ16) / Q16_ONE, y: Number(yQ16) / Q16_ONE });
}

function fieldDefaults(operator, rootSeed) {
  switch (operator) {
    case 'uniform':
      return { vectorXQ16: Math.round(Q16_ONE / 16), vectorYQ16: 0 };
    case 'attractor':
    case 'vortex':
      return { strengthQ16: Math.round(Q16_ONE / 2), radiusQ16: 64 * Q16_ONE };
    case 'turbulence':
      return { seed: rootSeed | 0, amplitudeQ16: Math.round(Q16_ONE / 3), cellSizeQ16: 8 * Q16_ONE };
    case 'direction-quantizer':
      return { sectors: 8 };
    default:
      throw new RangeError(`Unsupported field operator: ${String(operator)}.`);
  }
}

function createDefaultFields(rootSeed) {
  const fields = new FieldLayerCollection();
  fields.createLayer({
    kind: 'vector',
    operator: 'uniform',
    blend: 'add',
    parameters: fieldDefaults('uniform', rootSeed)
  });
  fields.createLayer({
    kind: 'vector',
    operator: 'vortex',
    blend: 'add',
    transform: { origin: worldPositionFromUnits(144, 128) },
    parameters: fieldDefaults('vortex', rootSeed)
  });
  return fields;
}

function cloneMaterialDefinition(material) {
  return {
    id: material.id,
    kind: material.kind,
    inertiaNumerator: material.inertiaNumerator,
    inertiaDenominator: material.inertiaDenominator,
    steeringNumerator: material.steeringNumerator,
    steeringDenominator: material.steeringDenominator,
    lifetimeTicks: material.lifetimeTicks,
    depositEvery: material.depositEvery,
    primitive: material.primitive,
    radiusQ16: material.radiusQ16,
    strengthQ16: material.strengthQ16,
    quantizeAxis: material.quantizeAxis
  };
}

function cloneEmitterDefinition(emitter) {
  const geometry = {
    ...emitter.geometry,
    origin: clonePosition(emitter.geometry.origin)
  };
  if (Array.isArray(emitter.geometry.points)) {
    geometry.points = emitter.geometry.points.map((point) => ({ ...point }));
  }
  return {
    id: emitter.id,
    materialId: emitter.materialId,
    startTick: emitter.startTick ?? 0,
    stopTick: emitter.stopTick ?? null,
    intervalTicks: emitter.intervalTicks ?? 1,
    rate: emitter.rate ?? 1,
    bursts: (emitter.bursts ?? []).map((burst) => ({ ...burst })),
    geometry,
    velocityXQ16: emitter.velocityXQ16 ?? 0,
    velocityYQ16: emitter.velocityYQ16 ?? 0,
    velocityJitterQ16: emitter.velocityJitterQ16 ?? 0
  };
}

function createDefaultEmitter(materialId) {
  return {
    id: 1,
    materialId,
    startTick: 0,
    stopTick: null,
    intervalTicks: 1,
    rate: 2,
    bursts: [],
    geometry: { type: 'point', origin: worldPositionFromUnits(52, 128) },
    velocityXQ16: Math.round(Q16_ONE * 0.9),
    velocityYQ16: 0,
    velocityJitterQ16: Math.round(Q16_ONE / 12)
  };
}

function nextStableId(records, label) {
  const maximum = records.reduce((value, record) => Math.max(value, record.id), 0);
  if (maximum >= UINT32_MAX - 1) throw new RangeError(`${label} ID space is exhausted.`);
  return maximum + 1;
}

function freezeEditorCommand(kind, redo, undo) {
  return Object.freeze({ kind, redo, undo });
}

export class EditorSession {
  constructor(options = {}) {
    this.rootSeed = assertUint32(options.rootSeed ?? DEFAULT_EDITOR_SEED, 'rootSeed');
    this.fieldCollection = options.fieldCollection ?? createDefaultFields(this.rootSeed);
    if (!this.fieldCollection || typeof this.fieldCollection.orderedLayers !== 'function') {
      throw new TypeError('fieldCollection must expose orderedLayers().');
    }

    const materials = options.materials ?? createBaselineMaterials();
    this._materials = materials.map(cloneMaterialDefinition).sort((a, b) => a.id - b.id);
    this._emitters = (options.emitters ?? [createDefaultEmitter(this._materials[0].id)])
      .map(cloneEmitterDefinition)
      .sort((a, b) => a.id - b.id);

    this.agentCapacity = assertPositiveInteger(options.agentCapacity ?? DEFAULT_AGENT_CAPACITY, 'agentCapacity', 1_000_000);
    this.maxDepositions = assertPositiveInteger(options.maxDepositions ?? DEFAULT_MAX_DEPOSITIONS, 'maxDepositions', 10_000_000);
    this.history = new AuthoringHistory(options.historyEntries ?? DEFAULT_HISTORY_ENTRIES);

    this.selectedFieldId = this.fieldCollection.order[0] ?? null;
    this.selectedEmitterId = this._emitters[0]?.id ?? null;
    this.selectedMaterialId = this._materials[0]?.id ?? null;
    this.tool = 'pan';
    this.running = false;
    this.speedMultiplier = 1;
    this.multiStepCount = 8;
    this.brush = Object.freeze({
      radius: 4,
      valueXQ16: Math.round(Q16_ONE / 2),
      valueYQ16: 0,
      falloff: 'linear-ring'
    });
    this.simulationRevision = 0;
    this._authoringRevision = 1;
    this._cachedAuthoringRevision = 0;
    this._cachedAuthoringHash = '';
    this.resetSimulation();
  }

  _touchAuthoring() {
    this._authoringRevision += 1;
    this._cachedAuthoringHash = '';
  }

  _buildSimulation(materials = this._materials, emitters = this._emitters) {
    return new DeterministicAgentSimulation({
      rootSeed: this.rootSeed,
      materials,
      emitters,
      fieldCollection: this.fieldCollection,
      capacity: this.agentCapacity,
      maxDepositions: this.maxDepositions
    });
  }

  _adoptRecipeDefinitions(materials, emitters) {
    const normalizedMaterials = materials.map(cloneMaterialDefinition).sort((a, b) => a.id - b.id);
    const normalizedEmitters = emitters.map(cloneEmitterDefinition).sort((a, b) => a.id - b.id);
    const simulation = this._buildSimulation(normalizedMaterials, normalizedEmitters);
    this._materials = normalizedMaterials;
    this._emitters = normalizedEmitters;
    this.simulation = simulation;
    this.running = false;
    this.simulationRevision += 1;
    this._touchAuthoring();
    return simulation;
  }

  resetSimulation() {
    this.running = false;
    this.simulation = this._buildSimulation();
    this.simulationRevision += 1;
    return this.simulation;
  }

  authoringHash() {
    if (this._cachedAuthoringRevision === this._authoringRevision && this._cachedAuthoringHash) {
      return this._cachedAuthoringHash;
    }
    const hash = canonicalHash({
      version: EDITOR_VERSION,
      rootSeed: this.rootSeed,
      fields: this.fieldCollection.toCanonical(),
      materials: this._materials,
      emitters: this._emitters
    });
    this._cachedAuthoringRevision = this._authoringRevision;
    this._cachedAuthoringHash = hash;
    return hash;
  }

  setTool(tool) {
    if (!EDITOR_TOOLS.includes(tool)) throw new RangeError(`Unsupported editor tool: ${String(tool)}.`);
    this.tool = tool;
    return tool;
  }

  setSpeedMultiplier(value) {
    assertFiniteNumber(value, 'speedMultiplier');
    if (!EDITOR_SPEEDS.includes(value)) {
      throw new RangeError(`speedMultiplier must be one of: ${EDITOR_SPEEDS.join(', ')}.`);
    }
    this.speedMultiplier = value;
    return value;
  }

  setMultiStepCount(count) {
    this.multiStepCount = assertPositiveInteger(count, 'multiStepCount', 100_000);
    return this.multiStepCount;
  }

  setBrush(options = {}) {
    const radius = options.radius ?? this.brush.radius;
    if (!Number.isInteger(radius) || radius < 0 || radius > 64) throw new RangeError('brush radius must be an integer in [0, 64].');
    const valueXQ16 = assertInt32(options.valueXQ16 ?? this.brush.valueXQ16, 'brush.valueXQ16');
    const valueYQ16 = assertInt32(options.valueYQ16 ?? this.brush.valueYQ16, 'brush.valueYQ16');
    const falloff = options.falloff ?? this.brush.falloff;
    if (!['flat', 'linear-ring'].includes(falloff)) throw new RangeError('brush falloff must be flat or linear-ring.');
    this.brush = Object.freeze({ radius, valueXQ16, valueYQ16, falloff });
    return this.brush;
  }

  run() { this.running = true; }
  pause() { this.running = false; }
  toggleRun() { this.running = !this.running; return this.running; }

  runTicks(count) {
    this.simulation.runTicks(assertPositiveInteger(count, 'count', UINT32_MAX));
    return this.simulation.tick;
  }

  singleStep() {
    this.pause();
    this.simulation.step();
    return this.simulation.tick;
  }

  multiStep(count = this.multiStepCount) {
    this.pause();
    this.simulation.runTicks(assertPositiveInteger(count, 'count', UINT32_MAX));
    return this.simulation.tick;
  }

  setRootSeed(seed) {
    this.rootSeed = assertUint32(seed, 'rootSeed');
    this._touchAuthoring();
    return this.resetSimulation();
  }

  selectField(id) {
    this.fieldCollection.getLayer(id);
    this.selectedFieldId = id;
    return id;
  }

  createField(operator = 'uniform') {
    this.pause();
    const layer = this.fieldCollection.createLayer({
      kind: 'vector',
      operator,
      blend: operator === 'direction-quantizer' ? 'replace' : 'add',
      transform: { origin: worldPositionFromUnits(128, 128) },
      parameters: fieldDefaults(operator, this.rootSeed)
    });
    validateFieldOperatorLayer(layer);
    this.selectedFieldId = layer.id;
    this.history.clear();
    this._touchAuthoring();
    this.resetSimulation();
    return layer;
  }

  deleteField(id = this.selectedFieldId) {
    if (id === null) return false;
    if (this.fieldCollection.size <= 1) throw new RangeError('At least one field layer must remain in the editor.');
    this.pause();
    const order = this.fieldCollection.order;
    const index = order.indexOf(id);
    const deleted = this.fieldCollection.deleteLayer(id);
    if (!deleted) return false;
    const nextOrder = this.fieldCollection.order;
    this.selectedFieldId = nextOrder[Math.min(index, nextOrder.length - 1)] ?? null;
    this.history.clear();
    this._touchAuthoring();
    this.resetSimulation();
    return true;
  }

  setFieldEnabled(id, enabled) {
    this.pause();
    const command = createLayerEnabledCommand(this.fieldCollection, id, enabled);
    this.history.execute(command, this.fieldCollection);
    this._touchAuthoring();
    this.resetSimulation();
  }

  moveField(id, toIndex) {
    this.pause();
    const command = createLayerMoveCommand(this.fieldCollection, id, toIndex);
    this.history.execute(command, this.fieldCollection);
    this._touchAuthoring();
    this.resetSimulation();
  }

  moveSelectedFieldBy(delta) {
    if (this.selectedFieldId === null) return false;
    const order = this.fieldCollection.order;
    const from = order.indexOf(this.selectedFieldId);
    const to = Math.max(0, Math.min(order.length - 1, from + delta));
    if (to === from) return false;
    this.moveField(this.selectedFieldId, to);
    return true;
  }

  moveSelectedFieldOrigin(position) {
    if (this.selectedFieldId === null) return false;
    this.pause();
    const layerId = this.selectedFieldId;
    const layer = this.fieldCollection.getLayer(layerId);
    const before = layer.transform;
    const after = Object.freeze({ ...before, origin: clonePosition(position) });
    const command = freezeEditorCommand(
      'field-transform',
      (model) => model.getLayer(layerId).setTransform(after),
      (model) => model.getLayer(layerId).setTransform(before)
    );
    this.history.execute(command, this.fieldCollection);
    this._touchAuthoring();
    this.resetSimulation();
    return true;
  }

  updateSelectedFieldParameter(name, value) {
    if (this.selectedFieldId === null) return false;
    if (typeof name !== 'string' || name.length === 0) throw new TypeError('Field parameter name is required.');
    this.pause();
    const layerId = this.selectedFieldId;
    const layer = this.fieldCollection.getLayer(layerId);
    const before = layer.parameters;
    const after = Object.freeze({ ...before, [name]: assertInt32(value, `parameters.${name}`) });
    const probe = new SparseFieldLayer({ ...layer.toCanonical(), parameters: after });
    validateFieldOperatorLayer(probe);
    const command = freezeEditorCommand(
      'field-parameters',
      (model) => model.getLayer(layerId).setParameters(after),
      (model) => model.getLayer(layerId).setParameters(before)
    );
    this.history.execute(command, this.fieldCollection);
    this._touchAuthoring();
    this.resetSimulation();
    return true;
  }

  paintStroke(worldPositions, operation = 'set') {
    if (this.selectedFieldId === null) return false;
    if (!Array.isArray(worldPositions) || worldPositions.length === 0) throw new TypeError('worldPositions must contain at least one point.');
    if (!['set', 'erase'].includes(operation)) throw new RangeError('Editor paint operation must be set or erase.');
    this.pause();
    const layer = this.fieldCollection.getLayer(this.selectedFieldId);
    if (layer.operator === 'direction-quantizer') {
      throw new RangeError('Direction-quantizer layers transform the stack and do not accept painted source vectors.');
    }
    const points = worldPositions.map((position) => {
      const cell = worldPositionToFieldCell(position, layer.cellsPerChunk);
      return fieldCellToGlobalGrid(cell, layer.cellsPerChunk);
    });
    const command = createBrushCommand(this.fieldCollection, layer.id, { points }, {
      operation,
      shape: 'circle',
      falloff: this.brush.falloff,
      radius: this.brush.radius,
      value: [this.brush.valueXQ16, this.brush.valueYQ16]
    });
    if (command.patch.length === 0) return false;
    this.history.execute(command, this.fieldCollection);
    this._touchAuthoring();
    this.resetSimulation();
    return true;
  }

  undoAuthoring() {
    this.pause();
    if (!this.history.undo(this.fieldCollection)) return false;
    this._touchAuthoring();
    this.resetSimulation();
    return true;
  }

  redoAuthoring() {
    this.pause();
    if (!this.history.redo(this.fieldCollection)) return false;
    this._touchAuthoring();
    this.resetSimulation();
    return true;
  }

  selectEmitter(id) {
    assertUint32(id, 'emitter.id');
    if (!this._emitters.some((emitter) => emitter.id === id)) throw new RangeError(`Unknown emitter ID ${id}.`);
    this.selectedEmitterId = id;
    return id;
  }

  addEmitter(position = worldPositionFromUnits(64, 128), materialId = this.selectedMaterialId ?? this._materials[0].id) {
    const id = nextStableId(this._emitters, 'Emitter');
    const candidate = [...this._emitters, {
      id,
      materialId,
      startTick: 0,
      stopTick: null,
      intervalTicks: 1,
      rate: 1,
      bursts: [],
      geometry: { type: 'point', origin: clonePosition(position) },
      velocityXQ16: Math.round(Q16_ONE * 0.8),
      velocityYQ16: 0,
      velocityJitterQ16: Math.round(Q16_ONE / 16)
    }];
    this._adoptRecipeDefinitions(this._materials, candidate);
    this.selectedEmitterId = id;
    return id;
  }

  deleteEmitter(id = this.selectedEmitterId) {
    if (id === null) return false;
    const candidate = this._emitters.filter((emitter) => emitter.id !== id);
    if (candidate.length === this._emitters.length) return false;
    this._adoptRecipeDefinitions(this._materials, candidate);
    this.selectedEmitterId = candidate[0]?.id ?? null;
    return true;
  }

  updateSelectedEmitter(patch) {
    if (this.selectedEmitterId === null) return false;
    const id = this.selectedEmitterId;
    const candidate = this._emitters.map((emitter) => {
      if (emitter.id !== id) return cloneEmitterDefinition(emitter);
      const next = cloneEmitterDefinition(emitter);
      if (patch.materialId !== undefined) next.materialId = assertUint32(patch.materialId, 'emitter.materialId');
      if (patch.rate !== undefined) next.rate = assertPositiveInteger(patch.rate, 'emitter.rate', 65535);
      if (patch.intervalTicks !== undefined) next.intervalTicks = assertPositiveInteger(patch.intervalTicks, 'emitter.intervalTicks', UINT32_MAX);
      if (patch.velocityXQ16 !== undefined) next.velocityXQ16 = assertInt32(patch.velocityXQ16, 'emitter.velocityXQ16');
      if (patch.velocityYQ16 !== undefined) next.velocityYQ16 = assertInt32(patch.velocityYQ16, 'emitter.velocityYQ16');
      if (patch.velocityJitterQ16 !== undefined) next.velocityJitterQ16 = assertInt32(patch.velocityJitterQ16, 'emitter.velocityJitterQ16');
      if (patch.origin !== undefined) next.geometry = { ...next.geometry, origin: clonePosition(patch.origin) };
      return next;
    });
    this._adoptRecipeDefinitions(this._materials, candidate);
    return true;
  }

  moveSelectedEmitter(position) {
    return this.updateSelectedEmitter({ origin: position });
  }

  selectMaterial(id) {
    assertUint32(id, 'material.id');
    if (!this._materials.some((material) => material.id === id)) throw new RangeError(`Unknown material ID ${id}.`);
    this.selectedMaterialId = id;
    return id;
  }

  updateSelectedMaterial(patch) {
    if (this.selectedMaterialId === null) return false;
    const id = this.selectedMaterialId;
    const candidate = this._materials.map((material) => {
      if (material.id !== id) return cloneMaterialDefinition(material);
      const next = cloneMaterialDefinition(material);
      if (patch.lifetimeTicks !== undefined) next.lifetimeTicks = assertPositiveInteger(patch.lifetimeTicks, 'material.lifetimeTicks', UINT32_MAX);
      if (patch.depositEvery !== undefined) next.depositEvery = assertPositiveInteger(patch.depositEvery, 'material.depositEvery', UINT32_MAX);
      if (patch.steeringNumerator !== undefined) next.steeringNumerator = assertPositiveInteger(patch.steeringNumerator, 'material.steeringNumerator');
      if (patch.steeringDenominator !== undefined) next.steeringDenominator = assertPositiveInteger(patch.steeringDenominator, 'material.steeringDenominator');
      if (patch.radiusQ16 !== undefined) {
        const radiusQ16 = assertPositiveInteger(patch.radiusQ16, 'material.radiusQ16', MAX_MATERIAL_INTERACTION_RADIUS_Q16);
        next.radiusQ16 = radiusQ16;
      }
      if (patch.strengthQ16 !== undefined) next.strengthQ16 = assertInt32(patch.strengthQ16, 'material.strengthQ16');
      return next;
    });
    this._adoptRecipeDefinitions(candidate, this._emitters);
    return true;
  }

  snapshot(backlogTicks = 0) {
    const fields = this.fieldCollection.orderedLayers().map((layer, index) => Object.freeze({
      id: layer.id,
      index,
      operator: layer.operator,
      enabled: layer.enabled,
      allocatedChunkCount: layer.allocatedChunkCount
    }));
    const selectedField = this.selectedFieldId === null ? null : this.fieldCollection.getLayer(this.selectedFieldId);
    const selectedEmitter = this.selectedEmitterId === null
      ? null
      : this._emitters.find((emitter) => emitter.id === this.selectedEmitterId) ?? null;
    const selectedMaterial = this.selectedMaterialId === null
      ? null
      : this._materials.find((material) => material.id === this.selectedMaterialId) ?? null;

    return Object.freeze({
      version: EDITOR_VERSION,
      rootSeed: this.rootSeed,
      authoringHash: this.authoringHash(),
      tool: this.tool,
      running: this.running,
      speedMultiplier: this.speedMultiplier,
      multiStepCount: this.multiStepCount,
      brush: this.brush,
      tick: this.simulation.tick,
      activeAgents: this.simulation.agents.length,
      depositions: this.simulation.depositions.length,
      droppedSpawns: this.simulation.droppedSpawns,
      backlogTicks: Math.max(0, Math.trunc(backlogTicks)),
      simulationRevision: this.simulationRevision,
      fields: Object.freeze(fields),
      selectedFieldId: this.selectedFieldId,
      selectedField: selectedField === null ? null : Object.freeze({
        id: selectedField.id,
        operator: selectedField.operator,
        enabled: selectedField.enabled,
        transform: selectedField.transform,
        parameters: selectedField.parameters,
        allocatedChunkCount: selectedField.allocatedChunkCount
      }),
      history: Object.freeze({ undoDepth: this.history.undoDepth, redoDepth: this.history.redoDepth }),
      emitters: Object.freeze(this._emitters.map((emitter) => Object.freeze({
        id: emitter.id,
        materialId: emitter.materialId,
        origin: emitter.geometry.origin,
        rate: emitter.rate,
        intervalTicks: emitter.intervalTicks
      }))),
      selectedEmitterId: this.selectedEmitterId,
      selectedEmitter: selectedEmitter === null ? null : Object.freeze(cloneEmitterDefinition(selectedEmitter)),
      materials: Object.freeze(this._materials.map((material) => Object.freeze(cloneMaterialDefinition(material)))),
      selectedMaterialId: this.selectedMaterialId,
      selectedMaterial: selectedMaterial === null ? null : Object.freeze(cloneMaterialDefinition(selectedMaterial)),
      materialKinds: MATERIAL_KINDS
    });
  }
}
