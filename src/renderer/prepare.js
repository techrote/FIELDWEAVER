import { CHUNK_SPAN_Q16, normalizeWorldPosition, translateWorldPosition } from '../core/coordinates.js';
import { Q16_ONE } from '../core/numeric.js';

export const RENDERER_VERSION = 'fw-webgl2-preview-v1';
export const DEFAULT_MAX_PREVIEW_DEPOSITIONS = 100_000;
export const MAX_PREVIEW_DEPOSITIONS = 1_000_000;
export const VERTEX_FLOATS = 7;

export const MATERIAL_PREVIEW_STYLES = Object.freeze({
  ink: Object.freeze({ rgba: Object.freeze([0.96, 0.43, 0.18, 0.72]), pointScale: 2.3 }),
  filament: Object.freeze({ rgba: Object.freeze([0.36, 0.91, 0.98, 0.86]), pointScale: 1.2 }),
  dust: Object.freeze({ rgba: Object.freeze([0.92, 0.84, 0.44, 0.58]), pointScale: 1.0 }),
  shard: Object.freeze({ rgba: Object.freeze([0.80, 0.48, 1.00, 0.90]), pointScale: 1.4 })
});

const EMITTER_RGBA = Object.freeze([1.0, 1.0, 1.0, 0.82]);
const FIELD_RGBA = Object.freeze([0.40, 0.95, 0.52, 0.72]);

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
  return value;
}

function assertPositiveInteger(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value <= 0 || value > max) {
    throw new RangeError(`${label} must be an integer in [1, ${max}].`);
  }
  return value;
}

function assertPosition(position, label = 'position') {
  if (position === null || typeof position !== 'object') throw new TypeError(`${label} must be a world position.`);
  return normalizeWorldPosition(position);
}

function axisAbsoluteQ16(position, axis) {
  const normalized = normalizeWorldPosition(position);
  const chunk = axis === 'x' ? normalized.chunkX : normalized.chunkY;
  const local = axis === 'x' ? normalized.localX : normalized.localY;
  return BigInt(chunk) * BigInt(CHUNK_SPAN_Q16) + BigInt(local);
}

export function createViewport(options = {}) {
  const widthCssPx = assertPositiveInteger(options.widthCssPx ?? 1280, 'viewport.widthCssPx', 32768);
  const heightCssPx = assertPositiveInteger(options.heightCssPx ?? 720, 'viewport.heightCssPx', 32768);
  const devicePixelRatio = assertFiniteNumber(options.devicePixelRatio ?? 1, 'viewport.devicePixelRatio');
  if (devicePixelRatio <= 0 || devicePixelRatio > 8) throw new RangeError('viewport.devicePixelRatio must be in (0, 8].');
  const zoom = assertFiniteNumber(options.zoom ?? 4, 'viewport.zoom');
  if (zoom < 0.01 || zoom > 4096) throw new RangeError('viewport.zoom must be in [0.01, 4096].');
  const center = assertPosition(options.center ?? {
    chunkX: 0,
    chunkY: 0,
    localX: 128 * Q16_ONE,
    localY: 128 * Q16_ONE
  }, 'viewport.center');

  return Object.freeze({ widthCssPx, heightCssPx, devicePixelRatio, zoom, center });
}

export function worldToCanvas(position, viewportInput) {
  const viewport = createViewport(viewportInput);
  const normalized = assertPosition(position);
  const dxQ16 = axisAbsoluteQ16(normalized, 'x') - axisAbsoluteQ16(viewport.center, 'x');
  const dyQ16 = axisAbsoluteQ16(normalized, 'y') - axisAbsoluteQ16(viewport.center, 'y');
  const x = viewport.widthCssPx / 2 + (Number(dxQ16) / Q16_ONE) * viewport.zoom;
  const y = viewport.heightCssPx / 2 - (Number(dyQ16) / Q16_ONE) * viewport.zoom;
  return Object.freeze({ x, y });
}

export function worldToClip(position, viewportInput) {
  const viewport = createViewport(viewportInput);
  const canvas = worldToCanvas(position, viewport);
  return Object.freeze({
    x: (canvas.x / viewport.widthCssPx) * 2 - 1,
    y: 1 - (canvas.y / viewport.heightCssPx) * 2
  });
}

export function panViewport(viewportInput, deltaCssX, deltaCssY) {
  const viewport = createViewport(viewportInput);
  assertFiniteNumber(deltaCssX, 'deltaCssX');
  assertFiniteNumber(deltaCssY, 'deltaCssY');
  const worldDeltaXQ16 = Math.round((-deltaCssX / viewport.zoom) * Q16_ONE);
  const worldDeltaYQ16 = Math.round((deltaCssY / viewport.zoom) * Q16_ONE);
  if (!Number.isSafeInteger(worldDeltaXQ16) || !Number.isSafeInteger(worldDeltaYQ16)) {
    throw new RangeError('Viewport pan exceeds safe view-only translation range.');
  }
  const center = translateWorldPosition(viewport.center, worldDeltaXQ16, worldDeltaYQ16);
  return createViewport({ ...viewport, center });
}

export function zoomViewport(viewportInput, factor) {
  const viewport = createViewport(viewportInput);
  assertFiniteNumber(factor, 'zoom factor');
  if (factor <= 0) throw new RangeError('zoom factor must be positive.');
  const zoom = Math.max(0.01, Math.min(4096, viewport.zoom * factor));
  return createViewport({ ...viewport, zoom });
}

function writeVertex(target, offset, clip, rgba, pointSize) {
  target[offset] = clip.x;
  target[offset + 1] = clip.y;
  target[offset + 2] = rgba[0];
  target[offset + 3] = rgba[1];
  target[offset + 4] = rgba[2];
  target[offset + 5] = rgba[3];
  target[offset + 6] = pointSize;
}

function validateDeposition(record, index) {
  if (record === null || typeof record !== 'object') throw new TypeError(`depositions[${index}] must be an object.`);
  if (!MATERIAL_PREVIEW_STYLES[record.materialKind]) throw new RangeError(`Unsupported deposition materialKind: ${String(record.materialKind)}.`);
  if (!['point', 'disc', 'segment'].includes(record.primitive)) throw new RangeError(`Unsupported deposition primitive: ${String(record.primitive)}.`);
  assertPosition(record.from, `depositions[${index}].from`);
  assertPosition(record.to, `depositions[${index}].to`);
  if (!Number.isInteger(record.radiusQ16) || record.radiusQ16 < 0) throw new RangeError(`depositions[${index}].radiusQ16 must be nonnegative integer.`);
  return record;
}

export class PreviewAccumulator {
  constructor(capacity = DEFAULT_MAX_PREVIEW_DEPOSITIONS) {
    this.capacity = assertPositiveInteger(capacity, 'preview capacity', MAX_PREVIEW_DEPOSITIONS);
    this._records = new Array(this.capacity);
    this._start = 0;
    this._size = 0;
    this.totalAccepted = 0;
    this.totalDropped = 0;
  }

  get size() { return this._size; }

  append(record) {
    validateDeposition(record, 0);
    this.totalAccepted += 1;
    if (this._size < this.capacity) {
      this._records[(this._start + this._size) % this.capacity] = record;
      this._size += 1;
      return;
    }
    this._records[this._start] = record;
    this._start = (this._start + 1) % this.capacity;
    this.totalDropped += 1;
  }

  appendMany(records, startIndex = 0) {
    if (!Array.isArray(records)) throw new TypeError('records must be an array.');
    if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > records.length) throw new RangeError('startIndex is out of range.');
    for (let index = startIndex; index < records.length; index += 1) this.append(records[index]);
  }

  reset() {
    this._records.fill(undefined);
    this._start = 0;
    this._size = 0;
    this.totalAccepted = 0;
    this.totalDropped = 0;
  }

  rebuild(records) {
    this.reset();
    const start = Math.max(0, records.length - this.capacity);
    this.totalDropped = start;
    this.totalAccepted = records.length;
    for (let index = start; index < records.length; index += 1) {
      const record = validateDeposition(records[index], index);
      this._records[this._size] = record;
      this._size += 1;
    }
  }

  snapshot() {
    const result = new Array(this._size);
    for (let index = 0; index < this._size; index += 1) {
      result[index] = this._records[(this._start + index) % this.capacity];
    }
    return result;
  }

  diagnostics() {
    return Object.freeze({
      capacity: this.capacity,
      size: this._size,
      totalAccepted: this.totalAccepted,
      totalDropped: this.totalDropped,
      truncated: this.totalDropped > 0
    });
  }
}

export function prepareDepositionGeometry(depositions, viewportInput) {
  if (!Array.isArray(depositions)) throw new TypeError('depositions must be an array.');
  const viewport = createViewport(viewportInput);
  let pointCount = 0;
  let lineVertexCount = 0;
  for (let index = 0; index < depositions.length; index += 1) {
    const record = validateDeposition(depositions[index], index);
    if (record.primitive === 'segment') lineVertexCount += 2;
    else pointCount += 1;
  }

  const points = new Float32Array(pointCount * VERTEX_FLOATS);
  const lines = new Float32Array(lineVertexCount * VERTEX_FLOATS);
  let pointOffset = 0;
  let lineOffset = 0;

  for (const record of depositions) {
    const style = MATERIAL_PREVIEW_STYLES[record.materialKind];
    const rawSize = Math.max(1, (record.radiusQ16 / Q16_ONE) * viewport.zoom * 2 * viewport.devicePixelRatio * style.pointScale);
    const pointSize = Math.min(128, rawSize);
    if (record.primitive === 'segment') {
      writeVertex(lines, lineOffset, worldToClip(record.from, viewport), style.rgba, pointSize);
      writeVertex(lines, lineOffset + VERTEX_FLOATS, worldToClip(record.to, viewport), style.rgba, pointSize);
      lineOffset += VERTEX_FLOATS * 2;
    } else {
      writeVertex(points, pointOffset, worldToClip(record.to, viewport), style.rgba, pointSize);
      pointOffset += VERTEX_FLOATS;
    }
  }

  return Object.freeze({
    points,
    lines,
    pointCount,
    lineVertexCount,
    byteLength: points.byteLength + lines.byteLength
  });
}

function overlayPointVertices(positions, viewport, rgba, pointSize) {
  const data = new Float32Array(positions.length * VERTEX_FLOATS);
  let offset = 0;
  for (const position of positions) {
    writeVertex(data, offset, worldToClip(position, viewport), rgba, pointSize * viewport.devicePixelRatio);
    offset += VERTEX_FLOATS;
  }
  return data;
}

export function prepareOverlayGeometry({ fieldCollection = null, emitters = [] } = {}, viewportInput) {
  const viewport = createViewport(viewportInput);
  if (!Array.isArray(emitters)) throw new TypeError('emitters must be an array.');
  const emitterPositions = emitters.map((emitter, index) => {
    if (!emitter || !emitter.geometry) throw new TypeError(`emitters[${index}] lacks geometry.`);
    return assertPosition(emitter.geometry.origin, `emitters[${index}].geometry.origin`);
  });
  const fieldPositions = [];
  if (fieldCollection !== null) {
    if (typeof fieldCollection.orderedLayers !== 'function') throw new TypeError('fieldCollection must expose orderedLayers().');
    for (const layer of fieldCollection.orderedLayers()) {
      if (layer.enabled && layer.transform?.origin) fieldPositions.push(assertPosition(layer.transform.origin));
    }
  }
  const emitterPoints = overlayPointVertices(emitterPositions, viewport, EMITTER_RGBA, 9);
  const fieldPoints = overlayPointVertices(fieldPositions, viewport, FIELD_RGBA, 7);
  return Object.freeze({
    emitterPoints,
    fieldPoints,
    emitterCount: emitterPositions.length,
    fieldCount: fieldPositions.length,
    byteLength: emitterPoints.byteLength + fieldPoints.byteLength
  });
}

export function prepareFrameModel({ depositions = [], fieldCollection = null, emitters = [] } = {}, viewportInput) {
  const viewport = createViewport(viewportInput);
  const artwork = prepareDepositionGeometry(depositions, viewport);
  const overlays = prepareOverlayGeometry({ fieldCollection, emitters }, viewport);
  return Object.freeze({ viewport, artwork, overlays });
}
