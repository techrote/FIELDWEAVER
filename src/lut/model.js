import { canonicalHash } from '../core/canonical.js';
import { INT32_MAX, INT32_MIN, Q16_ONE, assertInt32, assertUint32 } from '../core/numeric.js';

export const LUT_SCHEMA_VERSION = 'fw-lut-v1';
export const LUT_MAPPING_VERSION = 'fw-lut-map-v1';
export const LUT_VALUE_MAX = 0xffff;
export const MIN_LUT_SIZE = 2;
export const MAX_LUT_SIZE = 4096;
export const LUT_ADDRESS_MODES = Object.freeze(['clamp', 'wrap']);
export const LUT_SOURCES = Object.freeze([
  'constant',
  'ageTicks',
  'lifetimeProgressQ16',
  'speedMagnitudeQ16',
  'agentId',
  'emitterId',
  'spawnOrdinal'
]);
export const LUT_DESTINATIONS = Object.freeze([
  'color',
  'lifetimeMultiplierQ16',
  'steeringMultiplierQ16',
  'depositionStrengthQ16',
  'radiusQ16'
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSafeInteger(value, label) {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer.`);
  return value;
}

function assertPositiveInteger(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${label} must be an integer in [1, ${max}].`);
  }
  return value;
}

function assertUint16(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > LUT_VALUE_MAX) {
    throw new RangeError(`${label} must be an unsigned 16-bit integer.`);
  }
  return value;
}

function normalizeChannelName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(name)) {
    throw new RangeError('LUT channel names must match /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.');
  }
  return name;
}

function freezeChannels(channels, size) {
  if (!isPlainObject(channels)) throw new TypeError('LUT channels must be a plain object.');
  const names = Object.keys(channels).map(normalizeChannelName).sort();
  if (names.length === 0) throw new RangeError('A LUT requires at least one channel.');
  const normalized = {};
  for (const name of names) {
    const input = channels[name];
    if (!Array.isArray(input) && !ArrayBuffer.isView(input)) {
      throw new TypeError(`LUT channel ${name} must be an array or typed array.`);
    }
    if (input.length !== size) throw new RangeError(`LUT channel ${name} must contain exactly ${size} entries.`);
    normalized[name] = Object.freeze(Array.from(input, (value, index) => assertUint16(value, `channels.${name}[${index}]`)));
  }
  return Object.freeze(normalized);
}

export function createLutAsset(definition) {
  if (!isPlainObject(definition)) throw new TypeError('LUT asset definition must be a plain object.');
  const schemaVersion = definition.schemaVersion ?? LUT_SCHEMA_VERSION;
  if (schemaVersion !== LUT_SCHEMA_VERSION) throw new RangeError(`Unsupported LUT schema version: ${String(schemaVersion)}.`);
  const id = assertUint32(definition.id, 'lut.id');
  if (id === 0) throw new RangeError('LUT ID 0 is reserved.');
  const size = assertPositiveInteger(definition.size, 'lut.size', MAX_LUT_SIZE);
  if (size < MIN_LUT_SIZE) throw new RangeError(`lut.size must be at least ${MIN_LUT_SIZE}.`);
  const name = definition.name ?? `LUT ${id}`;
  if (typeof name !== 'string' || name.length === 0 || name.length > 96) throw new RangeError('lut.name must contain 1–96 characters.');
  return Object.freeze({
    schemaVersion,
    id,
    name,
    size,
    channels: freezeChannels(definition.channels, size)
  });
}

export function lutAssetToCanonical(assetInput) {
  const asset = createLutAsset(assetInput);
  const channels = {};
  for (const name of Object.keys(asset.channels).sort()) channels[name] = [...asset.channels[name]];
  return { schemaVersion: asset.schemaVersion, id: asset.id, name: asset.name, size: asset.size, channels };
}

export function hashLutAsset(asset) {
  return canonicalHash(lutAssetToCanonical(asset));
}

export function serializeLutAsset(asset) {
  return `${JSON.stringify(lutAssetToCanonical(asset), null, 2)}\n`;
}

export function parseLutAsset(text) {
  if (typeof text !== 'string') throw new TypeError('LUT JSON must be text.');
  let parsed;
  try { parsed = JSON.parse(text); } catch (error) { throw new SyntaxError(`Invalid LUT JSON: ${error.message}`); }
  return createLutAsset(parsed);
}

function normalizeMappingChannel(destination, channel) {
  if (destination === 'color') {
    if (channel !== undefined && channel !== 'rgba') throw new RangeError('Color mappings use the composite rgba channel selector.');
    return 'rgba';
  }
  return normalizeChannelName(channel);
}

export function createLutMapping(definition) {
  if (!isPlainObject(definition)) throw new TypeError('LUT mapping definition must be a plain object.');
  const version = definition.version ?? LUT_MAPPING_VERSION;
  if (version !== LUT_MAPPING_VERSION) throw new RangeError(`Unsupported LUT mapping version: ${String(version)}.`);
  const id = assertUint32(definition.id, 'mapping.id');
  if (id === 0) throw new RangeError('LUT mapping ID 0 is reserved.');
  const materialId = assertUint32(definition.materialId, 'mapping.materialId');
  if (materialId === 0) throw new RangeError('mapping.materialId must be nonzero.');
  const lutId = assertUint32(definition.lutId, 'mapping.lutId');
  if (lutId === 0) throw new RangeError('mapping.lutId must be nonzero.');
  const source = definition.source ?? 'ageTicks';
  if (!LUT_SOURCES.includes(source)) throw new RangeError(`Unsupported LUT source: ${String(source)}.`);
  const destination = definition.destination;
  if (!LUT_DESTINATIONS.includes(destination)) throw new RangeError(`Unsupported LUT destination: ${String(destination)}.`);
  const channel = normalizeMappingChannel(destination, definition.channel);
  const addressMode = definition.addressMode ?? 'clamp';
  if (!LUT_ADDRESS_MODES.includes(addressMode)) throw new RangeError(`Unsupported LUT address mode: ${String(addressMode)}.`);
  const inputMin = assertSafeInteger(definition.inputMin ?? 0, 'mapping.inputMin');
  const inputMax = assertSafeInteger(definition.inputMax ?? 1, 'mapping.inputMax');
  if (inputMax < inputMin) throw new RangeError('mapping.inputMax must be >= mapping.inputMin.');
  const scaleNumerator = assertInt32(definition.scaleNumerator ?? 1, 'mapping.scaleNumerator');
  const scaleDenominator = assertPositiveInteger(definition.scaleDenominator ?? 1, 'mapping.scaleDenominator', INT32_MAX);
  const bias = assertInt32(definition.bias ?? 0, 'mapping.bias');
  const outputMin = assertInt32(definition.outputMin ?? INT32_MIN, 'mapping.outputMin');
  const outputMax = assertInt32(definition.outputMax ?? INT32_MAX, 'mapping.outputMax');
  if (outputMax < outputMin) throw new RangeError('mapping.outputMax must be >= mapping.outputMin.');
  if (destination === 'color' && (outputMin < 0 || outputMax > LUT_VALUE_MAX)) {
    throw new RangeError(`Color mapping output bounds must stay within [0, ${LUT_VALUE_MAX}].`);
  }
  if ((destination === 'lifetimeMultiplierQ16' || destination === 'steeringMultiplierQ16') && outputMin < 0) {
    throw new RangeError(`${destination} cannot produce negative multipliers.`);
  }
  return Object.freeze({
    version,
    id,
    materialId,
    lutId,
    source,
    channel,
    destination,
    addressMode,
    inputMin,
    inputMax,
    scaleNumerator,
    scaleDenominator,
    bias,
    outputMin,
    outputMax
  });
}

function positiveModulo(value, modulus) {
  const remainder = value % modulus;
  return remainder < 0n ? remainder + modulus : remainder;
}

export function sampleLutIndex(mappingInput, sourceValue, size) {
  const mapping = createLutMapping(mappingInput);
  assertSafeInteger(sourceValue, 'sourceValue');
  assertPositiveInteger(size, 'size', MAX_LUT_SIZE);
  const min = BigInt(mapping.inputMin);
  const max = BigInt(mapping.inputMax);
  let value = BigInt(sourceValue);
  if (mapping.addressMode === 'wrap') {
    const period = max - min + 1n;
    value = min + positiveModulo(value - min, period);
  } else {
    if (value < min) value = min;
    if (value > max) value = max;
  }
  if (max === min) return 0;
  const numerator = (value - min) * BigInt(size - 1);
  return Number(numerator / (max - min));
}

function roundRatioHalfAwayFromZero(numerator, denominator) {
  if (denominator <= 0n) throw new RangeError('LUT mapping denominator must be positive.');
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  let quotient = absolute / denominator;
  const remainder = absolute % denominator;
  if (remainder * 2n >= denominator) quotient += 1n;
  return negative ? -quotient : quotient;
}

function scaleSample(sample, mapping) {
  const scaled = roundRatioHalfAwayFromZero(BigInt(sample) * BigInt(mapping.scaleNumerator), BigInt(mapping.scaleDenominator)) + BigInt(mapping.bias);
  const minimum = BigInt(mapping.outputMin);
  const maximum = BigInt(mapping.outputMax);
  if (scaled < minimum) return mapping.outputMin;
  if (scaled > maximum) return mapping.outputMax;
  return Number(scaled);
}

export function sampleLutMappedValue(assetInput, mappingInput, sourceValue) {
  const asset = createLutAsset(assetInput);
  const mapping = createLutMapping(mappingInput);
  if (mapping.destination === 'color') throw new RangeError('Use sampleLutColor() for color mappings.');
  const channel = asset.channels[mapping.channel];
  if (!channel) throw new RangeError(`LUT ${asset.id} has no channel named ${mapping.channel}.`);
  const index = sampleLutIndex(mapping, sourceValue, asset.size);
  return scaleSample(channel[index], mapping);
}

function u16ToU8(value) {
  return Math.floor((value * 255 + 32767) / LUT_VALUE_MAX);
}

export function sampleLutColor(assetInput, mappingInput, sourceValue) {
  const asset = createLutAsset(assetInput);
  const mapping = createLutMapping(mappingInput);
  if (mapping.destination !== 'color') throw new RangeError('sampleLutColor requires a color mapping.');
  for (const channel of ['r', 'g', 'b']) {
    if (!asset.channels[channel]) throw new RangeError(`Color LUT ${asset.id} requires ${channel} channel.`);
  }
  const index = sampleLutIndex(mapping, sourceValue, asset.size);
  const values = ['r', 'g', 'b', 'a'].map((channel) => {
    const sample = asset.channels[channel]?.[index] ?? LUT_VALUE_MAX;
    return u16ToU8(scaleSample(sample, mapping));
  });
  return Object.freeze(values);
}

export function resolveLutSourceValue(source, context = {}) {
  if (!LUT_SOURCES.includes(source)) throw new RangeError(`Unsupported LUT source: ${String(source)}.`);
  switch (source) {
    case 'constant': return 0;
    case 'ageTicks': return assertSafeInteger(context.ageTicks ?? 0, 'context.ageTicks');
    case 'lifetimeProgressQ16': {
      const age = BigInt(assertSafeInteger(context.ageTicks ?? 0, 'context.ageTicks'));
      const lifetime = BigInt(assertPositiveInteger(context.lifetimeTicks ?? 1, 'context.lifetimeTicks'));
      const progress = (age * BigInt(Q16_ONE)) / lifetime;
      return Number(progress > BigInt(Q16_ONE) ? BigInt(Q16_ONE) : progress);
    }
    case 'speedMagnitudeQ16': {
      const x = Math.abs(assertInt32(context.velocityXQ16 ?? 0, 'context.velocityXQ16'));
      const y = Math.abs(assertInt32(context.velocityYQ16 ?? 0, 'context.velocityYQ16'));
      return Math.max(x, y);
    }
    case 'agentId': return assertSafeInteger(context.agentId ?? 0, 'context.agentId');
    case 'emitterId': return assertSafeInteger(context.emitterId ?? 0, 'context.emitterId');
    case 'spawnOrdinal': return assertSafeInteger(context.spawnOrdinal ?? 0, 'context.spawnOrdinal');
    default: throw new RangeError(`Unsupported LUT source: ${source}.`);
  }
}

export class LutRegistry {
  constructor(assets = [], mappings = []) {
    if (!Array.isArray(assets)) throw new TypeError('LUT assets must be an array.');
    if (!Array.isArray(mappings)) throw new TypeError('LUT mappings must be an array.');
    this.assets = Object.freeze(assets.map(createLutAsset).sort((a, b) => a.id - b.id));
    this.assetById = new Map();
    for (const asset of this.assets) {
      if (this.assetById.has(asset.id)) throw new RangeError(`Duplicate LUT ID ${asset.id}.`);
      this.assetById.set(asset.id, asset);
    }
    this.mappings = Object.freeze(mappings.map(createLutMapping).sort((a, b) => a.id - b.id));
    this.mappingByMaterialDestination = new Map();
    const mappingIds = new Set();
    for (const mapping of this.mappings) {
      if (mappingIds.has(mapping.id)) throw new RangeError(`Duplicate LUT mapping ID ${mapping.id}.`);
      mappingIds.add(mapping.id);
      const asset = this.assetById.get(mapping.lutId);
      if (!asset) throw new RangeError(`LUT mapping ${mapping.id} references unknown LUT ${mapping.lutId}.`);
      if (mapping.destination === 'color') {
        for (const channel of ['r', 'g', 'b']) {
          if (!asset.channels[channel]) throw new RangeError(`Color mapping ${mapping.id} requires LUT ${asset.id} channel ${channel}.`);
        }
      } else if (!asset.channels[mapping.channel]) {
        throw new RangeError(`LUT mapping ${mapping.id} references missing channel ${mapping.channel}.`);
      }
      const key = `${mapping.materialId}:${mapping.destination}`;
      if (this.mappingByMaterialDestination.has(key)) {
        throw new RangeError(`Material ${mapping.materialId} has more than one ${mapping.destination} mapping.`);
      }
      this.mappingByMaterialDestination.set(key, mapping);
    }
  }

  asset(id) {
    const asset = this.assetById.get(assertUint32(id, 'lut.id'));
    if (!asset) throw new RangeError(`Unknown LUT ID ${id}.`);
    return asset;
  }

  mapping(materialId, destination) {
    assertUint32(materialId, 'materialId');
    if (!LUT_DESTINATIONS.includes(destination)) throw new RangeError(`Unsupported LUT destination: ${String(destination)}.`);
    return this.mappingByMaterialDestination.get(`${materialId}:${destination}`) ?? null;
  }

  sample(materialId, destination, context = {}) {
    const mapping = this.mapping(materialId, destination);
    if (mapping === null) return null;
    const asset = this.asset(mapping.lutId);
    const sourceValue = resolveLutSourceValue(mapping.source, context);
    return destination === 'color'
      ? sampleLutColor(asset, mapping, sourceValue)
      : sampleLutMappedValue(asset, mapping, sourceValue);
  }

  toCanonical() {
    return {
      schemaVersion: LUT_SCHEMA_VERSION,
      assets: this.assets.map(lutAssetToCanonical),
      mappings: this.mappings.map((mapping) => ({ ...mapping }))
    };
  }

  hash() { return canonicalHash(this.toCanonical()); }
}

function rampU16(index, size) {
  return Math.floor((index * LUT_VALUE_MAX) / (size - 1));
}

function triangleU16(index, size) {
  const doubled = Math.floor((index * LUT_VALUE_MAX * 2) / (size - 1));
  return doubled <= LUT_VALUE_MAX ? doubled : (LUT_VALUE_MAX * 2 - doubled);
}

export function createGeneratedLut({ id, name, size = 256, pattern = 'spectrum' }) {
  assertUint32(id, 'lut.id');
  assertPositiveInteger(size, 'lut.size', MAX_LUT_SIZE);
  if (size < MIN_LUT_SIZE) throw new RangeError(`lut.size must be at least ${MIN_LUT_SIZE}.`);
  if (!['spectrum', 'pulse'].includes(pattern)) throw new RangeError('LUT pattern must be spectrum or pulse.');
  const channels = { r: [], g: [], b: [], a: [], logic: [] };
  for (let index = 0; index < size; index += 1) {
    const ramp = rampU16(index, size);
    const triangle = triangleU16(index, size);
    if (pattern === 'spectrum') {
      channels.r.push(ramp);
      channels.g.push(LUT_VALUE_MAX - ramp);
      channels.b.push(triangle);
      channels.logic.push(ramp);
    } else {
      channels.r.push(triangle);
      channels.g.push(ramp);
      channels.b.push(LUT_VALUE_MAX - ramp);
      channels.logic.push(triangle);
    }
    channels.a.push(LUT_VALUE_MAX);
  }
  return createLutAsset({ id, name: name ?? `${pattern}-${size}`, size, channels });
}

export function createBuiltinLuts() {
  return Object.freeze([
    createGeneratedLut({ id: 1, name: 'Spectrum 256', size: 256, pattern: 'spectrum' }),
    createGeneratedLut({ id: 2, name: 'Pulse 512', size: 512, pattern: 'pulse' })
  ]);
}

export function createDefaultLutMappings() {
  return Object.freeze([
    createLutMapping({
      id: 1,
      materialId: 1,
      lutId: 1,
      source: 'ageTicks',
      channel: 'rgba',
      destination: 'color',
      addressMode: 'wrap',
      inputMin: 0,
      inputMax: 95,
      scaleNumerator: 1,
      scaleDenominator: 1,
      bias: 0,
      outputMin: 0,
      outputMax: LUT_VALUE_MAX
    }),
    createLutMapping({
      id: 2,
      materialId: 3,
      lutId: 2,
      source: 'ageTicks',
      channel: 'logic',
      destination: 'steeringMultiplierQ16',
      addressMode: 'wrap',
      inputMin: 0,
      inputMax: 47,
      scaleNumerator: 1,
      scaleDenominator: 1,
      bias: Q16_ONE / 2,
      outputMin: Q16_ONE / 2,
      outputMax: Q16_ONE + Q16_ONE / 2 - 1
    })
  ]);
}
