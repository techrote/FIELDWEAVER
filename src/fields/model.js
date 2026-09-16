import {
  INT32_MAX,
  INT32_MIN,
  Q16_ONE,
  UINT32_MAX,
  assertInt32,
  assertUint32
} from '../core/numeric.js';
import { CHUNK_SPAN_Q16, normalizeWorldPosition } from '../core/coordinates.js';
import { canonicalHash } from '../core/canonical.js';

export const FIELD_FORMAT_VERSION = 'fw-fields-v1';
export const FIELD_KINDS = Object.freeze(['scalar', 'vector']);
export const FIELD_BLEND_MODES = Object.freeze(['replace', 'add', 'min', 'max']);
export const DEFAULT_CELLS_PER_CHUNK = 256;
export const MIN_CELLS_PER_CHUNK = 1;
export const MAX_CELLS_PER_CHUNK = 256;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSafeInteger(value, label) {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer.`);
  return value;
}

function assertCellsPerChunk(value) {
  if (!Number.isInteger(value) || value < MIN_CELLS_PER_CHUNK || value > MAX_CELLS_PER_CHUNK || 256 % value !== 0) {
    throw new RangeError('cellsPerChunk must be an integer divisor of 256 in [1, 256].');
  }
  return value;
}

function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new RangeError(`${label} must be one of: ${allowed.join(', ')}.`);
  return value;
}

function normalizeParameters(parameters = {}) {
  if (!isPlainObject(parameters)) throw new TypeError('parameters must be a plain object.');
  const normalized = {};
  for (const key of Object.keys(parameters).sort()) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) {
      throw new RangeError(`Invalid field parameter key: ${key}`);
    }
    normalized[key] = assertInt32(parameters[key], `parameters.${key}`);
  }
  return Object.freeze(normalized);
}

function normalizeTransform(transform = {}) {
  const origin = normalizeWorldPosition(transform.origin ?? { chunkX: 0, chunkY: 0, localX: 0, localY: 0 });
  const scaleXQ16 = assertInt32(transform.scaleXQ16 ?? Q16_ONE, 'transform.scaleXQ16');
  const scaleYQ16 = assertInt32(transform.scaleYQ16 ?? Q16_ONE, 'transform.scaleYQ16');
  if (scaleXQ16 <= 0 || scaleYQ16 <= 0) throw new RangeError('Field transform scales must be positive Q16.16 values.');
  return Object.freeze({ origin, scaleXQ16, scaleYQ16 });
}

function channelCountForKind(kind) {
  return kind === 'scalar' ? 1 : 2;
}

function chunkKey(chunkX, chunkY) {
  return `${chunkX},${chunkY}`;
}

function compareChunkCoordinates(a, b) {
  if (a.chunkY !== b.chunkY) return a.chunkY - b.chunkY;
  return a.chunkX - b.chunkX;
}

function floorDiv(value, divisor) {
  const numerator = BigInt(assertSafeInteger(value, 'floorDiv value'));
  const denominator = BigInt(divisor);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder < 0n) quotient -= 1n;
  return Number(quotient);
}

export function normalizeFieldCellAddress(address, cellsPerChunk = DEFAULT_CELLS_PER_CHUNK) {
  const resolution = assertCellsPerChunk(cellsPerChunk);
  const inputChunkX = assertInt32(address.chunkX ?? 0, 'address.chunkX');
  const inputChunkY = assertInt32(address.chunkY ?? 0, 'address.chunkY');
  const inputCellX = assertSafeInteger(address.cellX, 'address.cellX');
  const inputCellY = assertSafeInteger(address.cellY, 'address.cellY');

  const deltaChunkX = floorDiv(inputCellX, resolution);
  const deltaChunkY = floorDiv(inputCellY, resolution);
  const chunkX = BigInt(inputChunkX) + BigInt(deltaChunkX);
  const chunkY = BigInt(inputChunkY) + BigInt(deltaChunkY);
  if (chunkX < BigInt(INT32_MIN) || chunkX > BigInt(INT32_MAX) || chunkY < BigInt(INT32_MIN) || chunkY > BigInt(INT32_MAX)) {
    throw new RangeError('Normalized field cell chunk coordinate overflowed signed 32-bit range.');
  }

  return Object.freeze({
    chunkX: Number(chunkX),
    chunkY: Number(chunkY),
    cellX: inputCellX - deltaChunkX * resolution,
    cellY: inputCellY - deltaChunkY * resolution
  });
}

export function fieldCellToGlobalGrid(address, cellsPerChunk = DEFAULT_CELLS_PER_CHUNK) {
  const normalized = normalizeFieldCellAddress(address, cellsPerChunk);
  return Object.freeze({
    x: normalized.chunkX * cellsPerChunk + normalized.cellX,
    y: normalized.chunkY * cellsPerChunk + normalized.cellY
  });
}

export function globalGridToFieldCell(x, y, cellsPerChunk = DEFAULT_CELLS_PER_CHUNK) {
  assertSafeInteger(x, 'x');
  assertSafeInteger(y, 'y');
  const resolution = assertCellsPerChunk(cellsPerChunk);
  return normalizeFieldCellAddress({ chunkX: 0, chunkY: 0, cellX: x, cellY: y }, resolution);
}

export function worldPositionToFieldCell(position, cellsPerChunk = DEFAULT_CELLS_PER_CHUNK) {
  const resolution = assertCellsPerChunk(cellsPerChunk);
  const normalized = normalizeWorldPosition(position);
  const cellSpanQ16 = CHUNK_SPAN_Q16 / resolution;
  return Object.freeze({
    chunkX: normalized.chunkX,
    chunkY: normalized.chunkY,
    cellX: Number(BigInt(normalized.localX) / BigInt(cellSpanQ16)),
    cellY: Number(BigInt(normalized.localY) / BigInt(cellSpanQ16))
  });
}

function normalizeChannels(kind, value, label = 'value') {
  if (kind === 'scalar') {
    return [assertInt32(value, label)];
  }
  if (!Array.isArray(value) && !(value instanceof Int32Array)) {
    throw new TypeError(`${label} must be a two-element integer vector.`);
  }
  if (value.length !== 2) throw new RangeError(`${label} must have exactly two channels.`);
  return [assertInt32(value[0], `${label}[0]`), assertInt32(value[1], `${label}[1]`)];
}

function publicValue(kind, channels) {
  return kind === 'scalar' ? channels[0] : Object.freeze([channels[0], channels[1]]);
}

export class SparseFieldLayer {
  constructor(definition) {
    if (!isPlainObject(definition)) throw new TypeError('Field layer definition must be a plain object.');
    this.id = assertUint32(definition.id, 'layer.id');
    if (this.id === 0) throw new RangeError('Field layer ID 0 is reserved.');
    this.kind = assertEnum(definition.kind ?? 'scalar', FIELD_KINDS, 'layer.kind');
    this.operator = definition.operator ?? 'painted';
    if (typeof this.operator !== 'string' || this.operator.length === 0 || this.operator.length > 64) {
      throw new RangeError('layer.operator must be a non-empty string of at most 64 characters.');
    }
    this.enabled = definition.enabled ?? true;
    if (typeof this.enabled !== 'boolean') throw new TypeError('layer.enabled must be boolean.');
    this.blend = assertEnum(definition.blend ?? 'add', FIELD_BLEND_MODES, 'layer.blend');
    this.cellsPerChunk = assertCellsPerChunk(definition.cellsPerChunk ?? DEFAULT_CELLS_PER_CHUNK);
    this.channelCount = channelCountForKind(this.kind);
    this.transform = normalizeTransform(definition.transform);
    this.parameters = normalizeParameters(definition.parameters);
    this._chunks = new Map();

    if (definition.chunks !== undefined) this._restoreChunks(definition.chunks);
  }

  get allocatedChunkCount() {
    return this._chunks.size;
  }

  setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean.');
    this.enabled = enabled;
  }

  setParameters(parameters) {
    this.parameters = normalizeParameters(parameters);
  }

  setTransform(transform) {
    this.transform = normalizeTransform(transform);
  }

  _chunkIndex(cellX, cellY, channel) {
    return ((cellY * this.cellsPerChunk + cellX) * this.channelCount) + channel;
  }

  _allocateChunk(chunkX, chunkY) {
    const key = chunkKey(chunkX, chunkY);
    let chunk = this._chunks.get(key);
    if (!chunk) {
      chunk = {
        chunkX,
        chunkY,
        values: new Int32Array(this.cellsPerChunk * this.cellsPerChunk * this.channelCount),
        nonZeroChannels: 0
      };
      this._chunks.set(key, chunk);
    }
    return chunk;
  }

  _readChannels(address) {
    const normalized = normalizeFieldCellAddress(address, this.cellsPerChunk);
    const chunk = this._chunks.get(chunkKey(normalized.chunkX, normalized.chunkY));
    if (!chunk) return new Array(this.channelCount).fill(0);
    const result = [];
    for (let channel = 0; channel < this.channelCount; channel += 1) {
      result.push(chunk.values[this._chunkIndex(normalized.cellX, normalized.cellY, channel)]);
    }
    return result;
  }

  readCell(address) {
    return publicValue(this.kind, this._readChannels(address));
  }

  writeCell(address, value) {
    const normalized = normalizeFieldCellAddress(address, this.cellsPerChunk);
    const channels = normalizeChannels(this.kind, value);
    const key = chunkKey(normalized.chunkX, normalized.chunkY);
    let chunk = this._chunks.get(key);
    const allZero = channels.every((entry) => entry === 0);
    if (!chunk && allZero) return false;
    if (!chunk) chunk = this._allocateChunk(normalized.chunkX, normalized.chunkY);

    let changed = false;
    for (let channel = 0; channel < this.channelCount; channel += 1) {
      const index = this._chunkIndex(normalized.cellX, normalized.cellY, channel);
      const before = chunk.values[index];
      const after = channels[channel];
      if (before === after) continue;
      if (before === 0 && after !== 0) chunk.nonZeroChannels += 1;
      if (before !== 0 && after === 0) chunk.nonZeroChannels -= 1;
      chunk.values[index] = after;
      changed = true;
    }

    if (chunk.nonZeroChannels === 0) this._chunks.delete(key);
    return changed;
  }

  clear() {
    this._chunks.clear();
  }

  _restoreChunks(chunks) {
    if (!Array.isArray(chunks)) throw new TypeError('layer.chunks must be an array.');
    let previous = null;
    for (const chunkRecord of chunks) {
      if (!isPlainObject(chunkRecord) || !Array.isArray(chunkRecord.cells)) {
        throw new TypeError('Each chunk record must contain a cells array.');
      }
      const chunkX = assertInt32(chunkRecord.chunkX, 'chunk.chunkX');
      const chunkY = assertInt32(chunkRecord.chunkY, 'chunk.chunkY');
      const current = { chunkX, chunkY };
      if (previous && compareChunkCoordinates(previous, current) >= 0) {
        throw new RangeError('Serialized chunks must be strictly ordered by (chunkY, chunkX).');
      }
      previous = current;
      let priorIndex = -1;
      for (const cell of chunkRecord.cells) {
        if (!Array.isArray(cell) || cell.length !== this.channelCount + 1) {
          throw new TypeError('Serialized cell record has the wrong channel count.');
        }
        const linearIndex = cell[0];
        if (!Number.isInteger(linearIndex) || linearIndex < 0 || linearIndex >= this.cellsPerChunk * this.cellsPerChunk || linearIndex <= priorIndex) {
          throw new RangeError('Serialized cell indices must be strictly increasing and in range.');
        }
        priorIndex = linearIndex;
        const cellX = linearIndex % this.cellsPerChunk;
        const cellY = Math.floor(linearIndex / this.cellsPerChunk);
        const channels = cell.slice(1).map((entry, index) => assertInt32(entry, `cell[${index + 1}]`));
        if (channels.every((entry) => entry === 0)) throw new RangeError('Serialized sparse cells must not contain all-zero values.');
        this.writeCell({ chunkX, chunkY, cellX, cellY }, this.kind === 'scalar' ? channels[0] : channels);
      }
    }
  }

  toCanonical() {
    const chunks = [...this._chunks.values()].sort(compareChunkCoordinates).map((chunk) => {
      const cells = [];
      const cellCount = this.cellsPerChunk * this.cellsPerChunk;
      for (let linearIndex = 0; linearIndex < cellCount; linearIndex += 1) {
        const base = linearIndex * this.channelCount;
        let nonZero = false;
        const channels = [];
        for (let channel = 0; channel < this.channelCount; channel += 1) {
          const value = chunk.values[base + channel];
          channels.push(value);
          if (value !== 0) nonZero = true;
        }
        if (nonZero) cells.push([linearIndex, ...channels]);
      }
      return { chunkX: chunk.chunkX, chunkY: chunk.chunkY, cells };
    });

    return {
      id: this.id,
      kind: this.kind,
      operator: this.operator,
      enabled: this.enabled,
      blend: this.blend,
      cellsPerChunk: this.cellsPerChunk,
      transform: this.transform,
      parameters: this.parameters,
      chunks
    };
  }

  hash() {
    return canonicalHash(this.toCanonical());
  }
}

export class FieldLayerCollection {
  constructor(serialized = null) {
    this._layers = new Map();
    this._order = [];
    this._nextId = 1;
    if (serialized !== null) this._restore(serialized);
  }

  get size() { return this._order.length; }
  get nextId() { return this._nextId; }
  get order() { return Object.freeze([...this._order]); }

  createLayer(definition = {}) {
    const explicitId = definition.id;
    const id = explicitId === undefined ? this._nextId : assertUint32(explicitId, 'layer.id');
    if (id === 0) throw new RangeError('Field layer ID 0 is reserved.');
    if (id === UINT32_MAX) throw new RangeError('Field layer ID 4294967295 is reserved as the exhausted next-ID sentinel.');
    if (this._layers.has(id)) throw new RangeError(`Field layer ID ${id} already exists.`);
    const layer = new SparseFieldLayer({ ...definition, id });
    this._layers.set(id, layer);
    this._order.push(id);
    if (id >= this._nextId) this._nextId = id + 1;
    return layer;
  }

  deleteLayer(id) {
    assertUint32(id, 'id');
    if (!this._layers.delete(id)) return false;
    this._order.splice(this._order.indexOf(id), 1);
    return true;
  }

  getLayer(id) {
    assertUint32(id, 'id');
    const layer = this._layers.get(id);
    if (!layer) throw new RangeError(`Unknown field layer ID ${id}.`);
    return layer;
  }

  orderedLayers() {
    return this._order.map((id) => this._layers.get(id));
  }

  moveLayer(id, toIndex) {
    assertUint32(id, 'id');
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= this._order.length) throw new RangeError('toIndex is out of range.');
    const fromIndex = this._order.indexOf(id);
    if (fromIndex < 0) throw new RangeError(`Unknown field layer ID ${id}.`);
    if (fromIndex === toIndex) return false;
    this._order.splice(fromIndex, 1);
    this._order.splice(toIndex, 0, id);
    return true;
  }

  setOrder(ids) {
    if (!Array.isArray(ids) || ids.length !== this._order.length) throw new RangeError('Layer order must contain every layer exactly once.');
    const seen = new Set();
    for (const id of ids) {
      assertUint32(id, 'layer order ID');
      if (!this._layers.has(id) || seen.has(id)) throw new RangeError('Layer order must contain every layer exactly once.');
      seen.add(id);
    }
    this._order = [...ids];
  }

  setEnabled(id, enabled) {
    this.getLayer(id).setEnabled(enabled);
  }

  toCanonical() {
    return {
      format: FIELD_FORMAT_VERSION,
      nextId: this._nextId,
      order: [...this._order],
      layers: this._order.map((id) => this._layers.get(id).toCanonical())
    };
  }

  hash() { return canonicalHash(this.toCanonical()); }

  _restore(serialized) {
    if (!isPlainObject(serialized) || serialized.format !== FIELD_FORMAT_VERSION) {
      throw new RangeError(`Unsupported field format; expected ${FIELD_FORMAT_VERSION}.`);
    }
    if (!Array.isArray(serialized.layers) || !Array.isArray(serialized.order)) throw new TypeError('Serialized field collection is malformed.');
    for (const layerRecord of serialized.layers) this.createLayer(layerRecord);
    this.setOrder(serialized.order);
    const nextId = assertUint32(serialized.nextId, 'nextId');
    const minimum = this._order.length === 0 ? 1 : Math.max(...this._order) + 1;
    if (nextId < minimum || (nextId === 0 && this._order.length > 0)) throw new RangeError('Serialized nextId would reuse a stable field-layer ID.');
    this._nextId = nextId;
  }

  static fromCanonical(serialized) {
    return new FieldLayerCollection(serialized);
  }
}
