import { CHUNK_SPAN_Q16, normalizeWorldPosition } from '../core/coordinates.js';
import { INT32_MAX, Q16_ONE } from '../core/numeric.js';

export const CANONICAL_RASTER_VERSION = 'fw-canonical-raster-v1';
export const DEFAULT_EXPORT_BACKGROUND_RGBA8 = Object.freeze([9, 11, 8, 255]);
export const CANONICAL_MATERIAL_RGBA8 = Object.freeze({
  ink: Object.freeze([245, 110, 46, 184]),
  filament: Object.freeze([92, 232, 250, 219]),
  dust: Object.freeze([235, 214, 112, 148]),
  shard: Object.freeze([204, 122, 255, 230])
});
export const MAX_EXPORT_DIMENSION = 100_000;
export const MAX_ASSEMBLED_PIXELS = 16_777_216;
export const DEFAULT_TILE_SIZE = 256;

const UINT32_MAX = 0xffffffff;
const BI_CHUNK_SPAN_Q16 = BigInt(CHUNK_SPAN_Q16);

function assertPositiveInteger(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${label} must be an integer in [1, ${max}].`);
  }
  return value;
}

function assertNonnegativeInteger(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${label} must be an integer in [0, ${max}].`);
  }
  return value;
}

function validateRgba8(value, label, { opaque = false } = {}) {
  if (!Array.isArray(value) || value.length !== 4) throw new TypeError(`${label} must be a 4-entry RGBA8 array.`);
  const normalized = value.map((channel, index) => {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
      throw new RangeError(`${label}[${index}] must be an integer in [0, 255].`);
    }
    return channel;
  });
  if (opaque && normalized[3] !== 255) throw new RangeError(`${label} alpha must be 255 for canonical export.`);
  return Object.freeze(normalized);
}

function absoluteAxisQ16(position, axis) {
  const normalized = normalizeWorldPosition(position);
  const chunk = axis === 'x' ? normalized.chunkX : normalized.chunkY;
  const local = axis === 'x' ? normalized.localX : normalized.localY;
  return BigInt(chunk) * BI_CHUNK_SPAN_Q16 + BigInt(local);
}

function floorDiv(numerator, denominator) {
  if (denominator <= 0n) throw new RangeError('floorDiv denominator must be positive.');
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder < 0n) quotient -= 1n;
  return quotient;
}

function ceilDiv(numerator, denominator) {
  return -floorDiv(-numerator, denominator);
}

function bigintToClampedNumber(value, low, high) {
  const lowBig = BigInt(low);
  const highBig = BigInt(high);
  if (value < lowBig) return low;
  if (value > highBig) return high;
  return Number(value);
}

export function normalizeExportCrop(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Export crop must be an object.');
  const widthPx = assertPositiveInteger(input.widthPx, 'crop.widthPx', MAX_EXPORT_DIMENSION);
  const heightPx = assertPositiveInteger(input.heightPx, 'crop.heightPx', MAX_EXPORT_DIMENSION);
  const unitsPerPixelQ16 = assertPositiveInteger(input.unitsPerPixelQ16, 'crop.unitsPerPixelQ16', INT32_MAX);
  const center = normalizeWorldPosition(input.center);
  return Object.freeze({ widthPx, heightPx, center: Object.freeze({ ...center }), unitsPerPixelQ16 });
}

function validateDeposition(record, index) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) throw new TypeError(`depositions[${index}] must be an object.`);
  const sequence = assertNonnegativeInteger(record.sequence, `depositions[${index}].sequence`, UINT32_MAX);
  assertNonnegativeInteger(record.tick, `depositions[${index}].tick`, UINT32_MAX);
  if (!Object.hasOwn(CANONICAL_MATERIAL_RGBA8, record.materialKind)) {
    throw new RangeError(`Unsupported deposition materialKind: ${String(record.materialKind)}.`);
  }
  if (!['point', 'disc', 'segment'].includes(record.primitive)) {
    throw new RangeError(`Unsupported deposition primitive: ${String(record.primitive)}.`);
  }
  const radiusQ16 = assertNonnegativeInteger(record.radiusQ16, `depositions[${index}].radiusQ16`, INT32_MAX);
  const strengthQ16 = assertNonnegativeInteger(record.strengthQ16, `depositions[${index}].strengthQ16`, INT32_MAX);
  const from = normalizeWorldPosition(record.from);
  const to = normalizeWorldPosition(record.to);
  const colorRgba8 = record.colorRgba8 === undefined
    ? CANONICAL_MATERIAL_RGBA8[record.materialKind]
    : validateRgba8(record.colorRgba8, `depositions[${index}].colorRgba8`);
  return Object.freeze({ record, sequence, radiusQ16, strengthQ16, from, to, colorRgba8 });
}

function normalizeDepositions(depositions) {
  if (!Array.isArray(depositions)) throw new TypeError('depositions must be an array.');
  const normalized = depositions.map(validateDeposition).sort((left, right) => left.sequence - right.sequence);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].sequence === normalized[index].sequence) {
      throw new RangeError(`Duplicate deposition sequence ${normalized[index].sequence}.`);
    }
  }
  return normalized;
}

function effectiveAlpha(colorAlpha, strengthQ16) {
  const scaled = (BigInt(colorAlpha) * BigInt(strengthQ16) + BigInt(Q16_ONE / 2)) / BigInt(Q16_ONE);
  if (scaled <= 0n) return 0;
  if (scaled >= 255n) return 255;
  return Number(scaled);
}

function blendOpaquePixel(target, offset, color, alpha) {
  if (alpha <= 0) return;
  if (alpha >= 255) {
    target[offset] = color[0];
    target[offset + 1] = color[1];
    target[offset + 2] = color[2];
    target[offset + 3] = 255;
    return;
  }
  const inverse = 255 - alpha;
  for (let channel = 0; channel < 3; channel += 1) {
    target[offset + channel] = Math.floor((color[channel] * alpha + target[offset + channel] * inverse + 127) / 255);
  }
  target[offset + 3] = 255;
}

function fillBackground(target, background) {
  for (let offset = 0; offset < target.length; offset += 4) {
    target[offset] = background[0];
    target[offset + 1] = background[1];
    target[offset + 2] = background[2];
    target[offset + 3] = 255;
  }
}

function pixelCenterWorld2(crop, x, y) {
  const centerX2 = 2n * absoluteAxisQ16(crop.center, 'x');
  const centerY2 = 2n * absoluteAxisQ16(crop.center, 'y');
  const units = BigInt(crop.unitsPerPixelQ16);
  return Object.freeze({
    x: centerX2 + BigInt(2 * x + 1 - crop.widthPx) * units,
    y: centerY2 + BigInt(crop.heightPx - (2 * y + 1)) * units
  });
}

function depositionGeometry2(item) {
  const ax = 2n * absoluteAxisQ16(item.from, 'x');
  const ay = 2n * absoluteAxisQ16(item.from, 'y');
  const bx = 2n * absoluteAxisQ16(item.to, 'x');
  const by = 2n * absoluteAxisQ16(item.to, 'y');
  const radius = 2n * BigInt(item.radiusQ16);
  if (item.record.primitive === 'segment') {
    return Object.freeze({ type: 'segment', ax, ay, bx, by, radius });
  }
  return Object.freeze({ type: 'disc', ax: bx, ay: by, bx, by, radius });
}

function pixelBoundsForGeometry(crop, geometry, tile) {
  const minX = (geometry.type === 'segment' ? (geometry.ax < geometry.bx ? geometry.ax : geometry.bx) : geometry.ax) - geometry.radius;
  const maxX = (geometry.type === 'segment' ? (geometry.ax > geometry.bx ? geometry.ax : geometry.bx) : geometry.ax) + geometry.radius;
  const minY = (geometry.type === 'segment' ? (geometry.ay < geometry.by ? geometry.ay : geometry.by) : geometry.ay) - geometry.radius;
  const maxY = (geometry.type === 'segment' ? (geometry.ay > geometry.by ? geometry.ay : geometry.by) : geometry.ay) + geometry.radius;
  const centerX2 = 2n * absoluteAxisQ16(crop.center, 'x');
  const centerY2 = 2n * absoluteAxisQ16(crop.center, 'y');
  const units = BigInt(crop.unitsPerPixelQ16);
  const stride = 2n * units;
  const xBase = centerX2 + BigInt(1 - crop.widthPx) * units;
  const yBase = centerY2 + BigInt(crop.heightPx - 1) * units;
  const globalMinX = ceilDiv(minX - xBase, stride);
  const globalMaxX = floorDiv(maxX - xBase, stride);
  const globalMinY = ceilDiv(yBase - maxY, stride);
  const globalMaxY = floorDiv(yBase - minY, stride);
  const tileMaxX = tile.x + tile.width - 1;
  const tileMaxY = tile.y + tile.height - 1;
  const minPixelX = bigintToClampedNumber(globalMinX, tile.x, tileMaxX);
  const maxPixelX = bigintToClampedNumber(globalMaxX, tile.x, tileMaxX);
  const minPixelY = bigintToClampedNumber(globalMinY, tile.y, tileMaxY);
  const maxPixelY = bigintToClampedNumber(globalMaxY, tile.y, tileMaxY);
  if (globalMaxX < BigInt(tile.x) || globalMinX > BigInt(tileMaxX) || globalMaxY < BigInt(tile.y) || globalMinY > BigInt(tileMaxY)) return null;
  return Object.freeze({ minPixelX, maxPixelX, minPixelY, maxPixelY });
}

function coversDisc(point, geometry) {
  const dx = point.x - geometry.ax;
  const dy = point.y - geometry.ay;
  return dx * dx + dy * dy <= geometry.radius * geometry.radius;
}

function coversSegment(point, geometry) {
  const vx = geometry.bx - geometry.ax;
  const vy = geometry.by - geometry.ay;
  const wx = point.x - geometry.ax;
  const wy = point.y - geometry.ay;
  const lengthSquared = vx * vx + vy * vy;
  if (lengthSquared === 0n) return coversDisc(point, { ...geometry, type: 'disc' });
  const projection = wx * vx + wy * vy;
  if (projection <= 0n) {
    const dx = point.x - geometry.ax;
    const dy = point.y - geometry.ay;
    return dx * dx + dy * dy <= geometry.radius * geometry.radius;
  }
  if (projection >= lengthSquared) {
    const dx = point.x - geometry.bx;
    const dy = point.y - geometry.by;
    return dx * dx + dy * dy <= geometry.radius * geometry.radius;
  }
  const cross = wx * vy - wy * vx;
  return cross * cross <= geometry.radius * geometry.radius * lengthSquared;
}

function rasterizeTileNormalized(depositions, crop, tile, background) {
  const rgba = new Uint8Array(tile.width * tile.height * 4);
  fillBackground(rgba, background);
  for (const item of depositions) {
    const alpha = effectiveAlpha(item.colorRgba8[3], item.strengthQ16);
    if (alpha === 0) continue;
    const geometry = depositionGeometry2(item);
    const bounds = pixelBoundsForGeometry(crop, geometry, tile);
    if (!bounds) continue;
    for (let y = bounds.minPixelY; y <= bounds.maxPixelY; y += 1) {
      for (let x = bounds.minPixelX; x <= bounds.maxPixelX; x += 1) {
        const point = pixelCenterWorld2(crop, x, y);
        const covered = geometry.type === 'segment' ? coversSegment(point, geometry) : coversDisc(point, geometry);
        if (!covered) continue;
        const localX = x - tile.x;
        const localY = y - tile.y;
        const offset = (localY * tile.width + localX) * 4;
        blendOpaquePixel(rgba, offset, item.colorRgba8, alpha);
      }
    }
  }
  return rgba;
}

function normalizeTileSize(value, label) {
  return assertPositiveInteger(value ?? DEFAULT_TILE_SIZE, label, MAX_EXPORT_DIMENSION);
}

export function* iterateRasterTiles(depositionsInput, cropInput, options = {}) {
  const crop = normalizeExportCrop(cropInput);
  const depositions = normalizeDepositions(depositionsInput);
  const background = validateRgba8(options.backgroundRgba8 ?? DEFAULT_EXPORT_BACKGROUND_RGBA8, 'backgroundRgba8', { opaque: true });
  const tileWidthPx = normalizeTileSize(options.tileWidthPx, 'tileWidthPx');
  const tileHeightPx = normalizeTileSize(options.tileHeightPx, 'tileHeightPx');
  for (let y = 0; y < crop.heightPx; y += tileHeightPx) {
    for (let x = 0; x < crop.widthPx; x += tileWidthPx) {
      const tile = Object.freeze({
        x,
        y,
        width: Math.min(tileWidthPx, crop.widthPx - x),
        height: Math.min(tileHeightPx, crop.heightPx - y)
      });
      yield Object.freeze({ ...tile, rgba: rasterizeTileNormalized(depositions, crop, tile, background) });
    }
  }
}

function assertAssemblable(crop) {
  const pixels = crop.widthPx * crop.heightPx;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_ASSEMBLED_PIXELS) {
    throw new RangeError(`Assembled canonical raster is limited to ${MAX_ASSEMBLED_PIXELS} pixels; use iterateRasterTiles() for larger crops.`);
  }
  return pixels;
}

export function rasterizeDepositions(depositionsInput, cropInput, options = {}) {
  const crop = normalizeExportCrop(cropInput);
  assertAssemblable(crop);
  const depositions = normalizeDepositions(depositionsInput);
  const background = validateRgba8(options.backgroundRgba8 ?? DEFAULT_EXPORT_BACKGROUND_RGBA8, 'backgroundRgba8', { opaque: true });
  const tile = Object.freeze({ x: 0, y: 0, width: crop.widthPx, height: crop.heightPx });
  return rasterizeTileNormalized(depositions, crop, tile, background);
}

export function rasterizeDepositionsTiled(depositionsInput, cropInput, options = {}) {
  const crop = normalizeExportCrop(cropInput);
  const pixels = assertAssemblable(crop);
  const rgba = new Uint8Array(pixels * 4);
  for (const tile of iterateRasterTiles(depositionsInput, crop, options)) {
    for (let row = 0; row < tile.height; row += 1) {
      const sourceStart = row * tile.width * 4;
      const targetStart = ((tile.y + row) * crop.widthPx + tile.x) * 4;
      rgba.set(tile.rgba.subarray(sourceStart, sourceStart + tile.width * 4), targetStart);
    }
  }
  return rgba;
}

export function rawRgbaHash(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('raw RGBA hash input must be Uint8Array.');
  if (bytes.length % 4 !== 0) throw new RangeError('raw RGBA byte length must be divisible by four.');
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}
