import { canonicalHash } from '../core/canonical.js';
import { Q16_ONE } from '../core/numeric.js';
import {
  LUT_VALUE_MAX,
  LutRegistry,
  createBuiltinLuts,
  createDefaultLutMappings,
  createGeneratedLut,
  createLutAsset,
  createLutMapping,
  hashLutAsset,
  parseLutAsset,
  serializeLutAsset
} from '../lut/index.js';
import { DeterministicAgentSimulation, MAX_MATERIAL_INTERACTION_RADIUS_Q16 } from '../sim/index.js';
import { EDITOR_VERSION, EditorSession, worldPositionFromUnits } from './model.js';

export const LUT_EDITOR_VERSION = 'fw-editor-lut-v1';

function cloneAsset(asset) {
  const channels = {};
  for (const [name, values] of Object.entries(asset.channels)) channels[name] = [...values];
  return createLutAsset({ schemaVersion: asset.schemaVersion, id: asset.id, name: asset.name, size: asset.size, channels });
}

function nextId(records, label) {
  const maximum = records.reduce((value, record) => Math.max(value, record.id), 0);
  if (maximum >= 0xfffffffe) throw new RangeError(`${label} ID space is exhausted.`);
  return maximum + 1;
}

function mappingDefaults(destination) {
  switch (destination) {
    case 'color':
      return { channel: 'rgba', scaleNumerator: 1, scaleDenominator: 1, bias: 0, outputMin: 0, outputMax: LUT_VALUE_MAX };
    case 'lifetimeMultiplierQ16':
    case 'steeringMultiplierQ16':
      return { scaleNumerator: 1, scaleDenominator: 1, bias: Q16_ONE / 2, outputMin: Q16_ONE / 2, outputMax: Q16_ONE + Q16_ONE / 2 - 1 };
    case 'depositionStrengthQ16':
      return { scaleNumerator: 1, scaleDenominator: 1, bias: 0, outputMin: 0, outputMax: LUT_VALUE_MAX };
    case 'radiusQ16':
      return { scaleNumerator: 1, scaleDenominator: 2, bias: 1, outputMin: 1, outputMax: MAX_MATERIAL_INTERACTION_RADIUS_Q16 };
    default:
      throw new RangeError(`Unsupported LUT destination: ${String(destination)}.`);
  }
}

export class LutEditorSession extends EditorSession {
  constructor(options = {}) {
    super(options);
    this._lutAssets = (options.lutAssets ?? createBuiltinLuts()).map(cloneAsset).sort((a, b) => a.id - b.id);
    this._lutMappings = (options.lutMappings ?? createDefaultLutMappings()).map(createLutMapping).sort((a, b) => a.id - b.id);

    // Fresh FW-008 sessions visibly exercise both LUT roles: Ink receives the
    // Spectrum colour map and Dust receives the Pulse steering map.
    if (options.emitters === undefined && !this._emitters.some((emitter) => emitter.materialId === 3)) {
      this._emitters.push({
        id: nextId(this._emitters, 'Emitter'),
        materialId: 3,
        startTick: 0,
        stopTick: undefined,
        intervalTicks: 2,
        rate: 1,
        bursts: [],
        geometry: { type: 'point', origin: worldPositionFromUnits(176, 118) },
        velocityXQ16: -Math.round(Q16_ONE * 0.45),
        velocityYQ16: Math.round(Q16_ONE * 0.08),
        velocityJitterQ16: Math.round(Q16_ONE / 10)
      });
      this._emitters.sort((a, b) => a.id - b.id);
    }

    this.selectedLutId = this._lutAssets[0]?.id ?? null;
    this.selectedLutChannel = this._lutAssets[0] ? Object.keys(this._lutAssets[0].channels)[0] : null;
    this._lutHashRevision = 0;
    this._lutCachedAuthoringHash = '';
    this._validateLuts();
    this._touchAuthoring();
    this.resetSimulation();
  }

  _buildSimulation(materials = this._materials, emitters = this._emitters) {
    if (!this._lutAssets || !this._lutMappings) return super._buildSimulation(materials, emitters);
    return new DeterministicAgentSimulation({
      rootSeed: this.rootSeed,
      materials,
      emitters,
      fieldCollection: this.fieldCollection,
      lutAssets: this._lutAssets,
      lutMappings: this._lutMappings,
      capacity: this.agentCapacity,
      maxDepositions: this.maxDepositions
    });
  }

  _validateLuts(assets = this._lutAssets, mappings = this._lutMappings) {
    const registry = new LutRegistry(assets, mappings);
    const materialIds = new Set(this._materials.map((material) => material.id));
    for (const mapping of registry.mappings) {
      if (!materialIds.has(mapping.materialId)) throw new RangeError(`LUT mapping ${mapping.id} references unknown material ${mapping.materialId}.`);
    }
    return registry;
  }

  lutRegistry() { return this._validateLuts(); }

  authoringHash() {
    if (this._lutAssets && this._lutHashRevision === this._authoringRevision && this._lutCachedAuthoringHash) {
      return this._lutCachedAuthoringHash;
    }
    const baseHash = canonicalHash({
      version: EDITOR_VERSION,
      rootSeed: this.rootSeed,
      fields: this.fieldCollection.toCanonical(),
      materials: this.simulation.materials,
      emitters: this.simulation.emitters
    });
    const lut = this._lutAssets ? this.lutRegistry().toCanonical() : { assets: [], mappings: [] };
    const hash = canonicalHash({ version: LUT_EDITOR_VERSION, baseHash, lut });
    if (this._lutAssets) {
      this._lutHashRevision = this._authoringRevision;
      this._lutCachedAuthoringHash = hash;
    }
    return hash;
  }

  selectLut(id) {
    const asset = this._lutAssets.find((entry) => entry.id === Number(id));
    if (!asset) throw new RangeError(`Unknown LUT ID ${id}.`);
    this.selectedLutId = asset.id;
    if (!asset.channels[this.selectedLutChannel]) this.selectedLutChannel = Object.keys(asset.channels)[0];
    return asset.id;
  }

  selectLutChannel(channel) {
    const asset = this.selectedLut();
    if (!asset.channels[channel]) throw new RangeError(`LUT ${asset.id} has no channel ${String(channel)}.`);
    this.selectedLutChannel = channel;
    return channel;
  }

  selectedLut() {
    if (this.selectedLutId === null) throw new RangeError('No LUT is selected.');
    const asset = this._lutAssets.find((entry) => entry.id === this.selectedLutId);
    if (!asset) throw new RangeError(`Unknown LUT ID ${this.selectedLutId}.`);
    return asset;
  }

  updateSelectedLutEntry(channel, index, value) {
    const asset = this.selectedLut();
    if (!Number.isInteger(index) || index < 0 || index >= asset.size) throw new RangeError(`LUT entry index must be in [0, ${asset.size - 1}].`);
    if (!Number.isInteger(value) || value < 0 || value > LUT_VALUE_MAX) throw new RangeError(`LUT entry value must be in [0, ${LUT_VALUE_MAX}].`);
    if (!asset.channels[channel]) throw new RangeError(`LUT ${asset.id} has no channel ${String(channel)}.`);
    const channels = {};
    for (const [name, values] of Object.entries(asset.channels)) channels[name] = [...values];
    channels[channel][index] = value;
    const replacement = createLutAsset({ id: asset.id, name: asset.name, size: asset.size, channels });
    const candidate = this._lutAssets.map((entry) => entry.id === asset.id ? replacement : entry);
    this._validateLuts(candidate, this._lutMappings);
    this._lutAssets = candidate;
    this.selectedLutChannel = channel;
    this._touchAuthoring();
    this.resetSimulation();
    return replacement;
  }

  generateLut(size = 256, pattern = 'spectrum') {
    const id = nextId(this._lutAssets, 'LUT');
    const asset = createGeneratedLut({ id, size, pattern, name: `${pattern} ${size} #${id}` });
    const candidate = [...this._lutAssets, asset].sort((a, b) => a.id - b.id);
    this._validateLuts(candidate, this._lutMappings);
    this._lutAssets = candidate;
    this.selectedLutId = id;
    this.selectedLutChannel = Object.keys(asset.channels)[0];
    this._touchAuthoring();
    this.resetSimulation();
    return id;
  }

  importLutJson(text) {
    const asset = parseLutAsset(text);
    if (this._lutAssets.some((entry) => entry.id === asset.id)) throw new RangeError(`LUT ID ${asset.id} already exists; change the imported ID explicitly.`);
    const candidate = [...this._lutAssets, asset].sort((a, b) => a.id - b.id);
    this._validateLuts(candidate, this._lutMappings);
    this._lutAssets = candidate;
    this.selectedLutId = asset.id;
    this.selectedLutChannel = Object.keys(asset.channels)[0];
    this._touchAuthoring();
    this.resetSimulation();
    return asset.id;
  }

  exportSelectedLutJson() { return serializeLutAsset(this.selectedLut()); }

  assignSelectedMaterialLut({ destination, source = 'ageTicks', channel = undefined, addressMode = 'clamp' }) {
    if (this.selectedMaterialId === null) throw new RangeError('Select a material before assigning a LUT mapping.');
    const asset = this.selectedLut();
    const defaults = mappingDefaults(destination);
    const selectedChannel = channel ?? (destination === 'color' ? 'rgba' : this.selectedLutChannel);
    if (destination !== 'color' && !asset.channels[selectedChannel]) throw new RangeError(`LUT ${asset.id} has no channel ${selectedChannel}.`);
    const existing = this._lutMappings.find((mapping) => mapping.materialId === this.selectedMaterialId && mapping.destination === destination);
    const mapping = createLutMapping({
      id: existing?.id ?? nextId(this._lutMappings, 'LUT mapping'),
      materialId: this.selectedMaterialId,
      lutId: asset.id,
      source,
      channel: destination === 'color' ? 'rgba' : selectedChannel,
      destination,
      addressMode,
      inputMin: 0,
      inputMax: source === 'lifetimeProgressQ16' ? Q16_ONE : Math.max(1, asset.size - 1),
      ...defaults
    });
    const candidate = this._lutMappings.filter((entry) => !(entry.materialId === mapping.materialId && entry.destination === destination));
    candidate.push(mapping);
    candidate.sort((a, b) => a.id - b.id);
    this._validateLuts(this._lutAssets, candidate);
    this._lutMappings = candidate;
    this._touchAuthoring();
    this.resetSimulation();
    return mapping.id;
  }

  removeSelectedMaterialLutMapping(destination) {
    if (this.selectedMaterialId === null) return false;
    const candidate = this._lutMappings.filter((entry) => !(entry.materialId === this.selectedMaterialId && entry.destination === destination));
    if (candidate.length === this._lutMappings.length) return false;
    this._validateLuts(this._lutAssets, candidate);
    this._lutMappings = candidate;
    this._touchAuthoring();
    this.resetSimulation();
    return true;
  }

  snapshot(backlogTicks = 0) {
    const base = super.snapshot(backlogTicks);
    const selectedLut = this.selectedLutId === null ? null : this._lutAssets.find((entry) => entry.id === this.selectedLutId) ?? null;
    return Object.freeze({
      ...base,
      authoringHash: this.authoringHash(),
      lutAssets: Object.freeze(this._lutAssets.map((asset) => Object.freeze({
        id: asset.id,
        name: asset.name,
        size: asset.size,
        hash: hashLutAsset(asset),
        channels: Object.freeze(Object.keys(asset.channels))
      }))),
      lutMappings: Object.freeze(this._lutMappings.map((mapping) => Object.freeze({ ...mapping }))),
      selectedLutId: this.selectedLutId,
      selectedLutChannel: this.selectedLutChannel,
      selectedLut: selectedLut === null ? null : Object.freeze({
        id: selectedLut.id,
        name: selectedLut.name,
        size: selectedLut.size,
        channels: Object.freeze(Object.fromEntries(Object.entries(selectedLut.channels).map(([name, values]) => [name, Object.freeze([...values])])))
      })
    });
  }
}
