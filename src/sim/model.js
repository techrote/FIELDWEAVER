import {
  INT32_MAX,
  Q16_ONE,
  UINT32_MAX,
  addSaturatedInt32,
  assertInt32,
  assertUint32,
  q16ScaleByRatio
} from '../core/numeric.js';
import { normalizeWorldPosition, translateWorldPosition } from '../core/coordinates.js';
import { canonicalHash } from '../core/canonical.js';
import { Xoshiro128StarStar } from '../core/prng.js';
import { sampleFieldStack } from '../fields/operators.js';

export const SIMULATION_VERSION = 'fw-agents-v1';
export const MATERIAL_KINDS = Object.freeze(['ink', 'filament', 'dust', 'shard']);
export const EMITTER_GEOMETRIES = Object.freeze(['point', 'box', 'mask']);
export const MAX_SPEED_Q16 = 4 * Q16_ONE;
export const MAX_STEP_DISPLACEMENT_Q16 = MAX_SPEED_Q16;
export const MAX_MATERIAL_INTERACTION_RADIUS_Q16 = Q16_ONE / 2;
export const MAX_EMITTER_JITTER_Q16 = 8 * Q16_ONE;
export const MAX_EMITTER_EXTENT_Q16 = 1024 * Q16_ONE;

const ZERO_FIELD = Object.freeze({ xQ16: 0, yQ16: 0 });
const MATERIAL_PRESETS = Object.freeze({
  ink: Object.freeze({
    inertiaNumerator: 3,
    inertiaDenominator: 4,
    steeringNumerator: 1,
    steeringDenominator: 2,
    lifetimeTicks: 96,
    depositEvery: 1,
    primitive: 'disc',
    radiusQ16: Q16_ONE / 2,
    strengthQ16: Q16_ONE,
    quantizeAxis: false
  }),
  filament: Object.freeze({
    inertiaNumerator: 7,
    inertiaDenominator: 8,
    steeringNumerator: 1,
    steeringDenominator: 4,
    lifetimeTicks: 160,
    depositEvery: 1,
    primitive: 'segment',
    radiusQ16: Q16_ONE / 4,
    strengthQ16: 3 * Q16_ONE / 4,
    quantizeAxis: false
  }),
  dust: Object.freeze({
    inertiaNumerator: 1,
    inertiaDenominator: 4,
    steeringNumerator: 3,
    steeringDenominator: 4,
    lifetimeTicks: 48,
    depositEvery: 2,
    primitive: 'point',
    radiusQ16: Q16_ONE / 8,
    strengthQ16: Q16_ONE / 2,
    quantizeAxis: false
  }),
  shard: Object.freeze({
    inertiaNumerator: 1,
    inertiaDenominator: 2,
    steeringNumerator: 1,
    steeringDenominator: 1,
    lifetimeTicks: 72,
    depositEvery: 1,
    primitive: 'segment',
    radiusQ16: 10923,
    strengthQ16: Q16_ONE,
    quantizeAxis: true
  })
});

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPositiveInteger(value, label, max = INT32_MAX) {
  if (!Number.isInteger(value) || value <= 0 || value > max) {
    throw new RangeError(`${label} must be an integer in [1, ${max}].`);
  }
  return value;
}

function assertNonnegativeInteger(value, label, max = INT32_MAX) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${label} must be an integer in [0, ${max}].`);
  }
  return value;
}

function clonePosition(position) {
  const normalized = normalizeWorldPosition(position);
  return Object.freeze({ ...normalized });
}

function clampSpeedComponent(value) {
  assertInt32(value, 'velocity');
  return Math.max(-MAX_SPEED_Q16, Math.min(MAX_SPEED_Q16, value));
}

function quantizeAxisVelocity(xQ16, yQ16) {
  if (xQ16 === 0 && yQ16 === 0) return ZERO_FIELD;
  const absoluteX = xQ16 === -0x80000000 ? INT32_MAX : Math.abs(xQ16);
  const absoluteY = yQ16 === -0x80000000 ? INT32_MAX : Math.abs(yQ16);
  const magnitude = Math.max(absoluteX, absoluteY);
  if (absoluteX >= absoluteY) {
    return Object.freeze({ xQ16: xQ16 < 0 ? -magnitude : magnitude, yQ16: 0 });
  }
  return Object.freeze({ xQ16: 0, yQ16: yQ16 < 0 ? -magnitude : magnitude });
}

export function createBaselineMaterials() {
  return MATERIAL_KINDS.map((kind, index) => Object.freeze({
    id: index + 1,
    kind,
    ...MATERIAL_PRESETS[kind]
  }));
}

function normalizeMaterial(definition) {
  if (!isPlainObject(definition)) throw new TypeError('Material definition must be a plain object.');
  const id = assertUint32(definition.id, 'material.id');
  if (id === 0) throw new RangeError('Material ID 0 is reserved.');
  const kind = definition.kind;
  if (!MATERIAL_KINDS.includes(kind)) throw new RangeError(`Unsupported material kind: ${String(kind)}.`);
  const preset = MATERIAL_PRESETS[kind];
  const material = {
    id,
    kind,
    inertiaNumerator: assertPositiveInteger(definition.inertiaNumerator ?? preset.inertiaNumerator, 'material.inertiaNumerator'),
    inertiaDenominator: assertPositiveInteger(definition.inertiaDenominator ?? preset.inertiaDenominator, 'material.inertiaDenominator'),
    steeringNumerator: assertNonnegativeInteger(definition.steeringNumerator ?? preset.steeringNumerator, 'material.steeringNumerator'),
    steeringDenominator: assertPositiveInteger(definition.steeringDenominator ?? preset.steeringDenominator, 'material.steeringDenominator'),
    lifetimeTicks: assertPositiveInteger(definition.lifetimeTicks ?? preset.lifetimeTicks, 'material.lifetimeTicks'),
    depositEvery: assertPositiveInteger(definition.depositEvery ?? preset.depositEvery, 'material.depositEvery'),
    primitive: definition.primitive ?? preset.primitive,
    radiusQ16: assertPositiveInteger(definition.radiusQ16 ?? preset.radiusQ16, 'material.radiusQ16', MAX_MATERIAL_INTERACTION_RADIUS_Q16),
    strengthQ16: assertNonnegativeInteger(definition.strengthQ16 ?? preset.strengthQ16, 'material.strengthQ16'),
    quantizeAxis: definition.quantizeAxis ?? preset.quantizeAxis
  };
  if (!['point', 'disc', 'segment'].includes(material.primitive)) throw new RangeError('material.primitive must be point, disc, or segment.');
  if (typeof material.quantizeAxis !== 'boolean') throw new TypeError('material.quantizeAxis must be boolean.');
  return Object.freeze(material);
}

function normalizeMaterials(materials) {
  if (!Array.isArray(materials) || materials.length === 0) throw new RangeError('At least one material is required.');
  const normalized = materials.map(normalizeMaterial).sort((a, b) => a.id - b.id);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].id === normalized[index].id) throw new RangeError(`Duplicate material ID ${normalized[index].id}.`);
  }
  return normalized;
}

function normalizeGeometry(geometry) {
  if (!isPlainObject(geometry)) throw new TypeError('emitter.geometry must be a plain object.');
  const type = geometry.type ?? 'point';
  if (!EMITTER_GEOMETRIES.includes(type)) throw new RangeError(`Unsupported emitter geometry: ${String(type)}.`);
  const origin = clonePosition(geometry.origin ?? { chunkX: 0, chunkY: 0, localX: 0, localY: 0 });
  if (type === 'point') return Object.freeze({ type, origin });
  if (type === 'box') {
    return Object.freeze({
      type,
      origin,
      widthQ16: assertNonnegativeInteger(geometry.widthQ16 ?? 0, 'geometry.widthQ16', MAX_EMITTER_EXTENT_Q16),
      heightQ16: assertNonnegativeInteger(geometry.heightQ16 ?? 0, 'geometry.heightQ16', MAX_EMITTER_EXTENT_Q16)
    });
  }
  if (!Array.isArray(geometry.points) || geometry.points.length === 0) {
    throw new RangeError('Mask geometry requires a non-empty points array.');
  }
  const points = geometry.points.map((point, index) => {
    if (!isPlainObject(point)) throw new TypeError(`geometry.points[${index}] must be a plain object.`);
    return Object.freeze({
      xQ16: assertInt32(point.xQ16, `geometry.points[${index}].xQ16`),
      yQ16: assertInt32(point.yQ16, `geometry.points[${index}].yQ16`)
    });
  });
  return Object.freeze({ type, origin, points: Object.freeze(points) });
}

function normalizeBursts(bursts = []) {
  if (!Array.isArray(bursts)) throw new TypeError('emitter.bursts must be an array.');
  const normalized = bursts.map((burst, index) => {
    if (!isPlainObject(burst)) throw new TypeError(`emitter.bursts[${index}] must be a plain object.`);
    return Object.freeze({
      tick: assertNonnegativeInteger(burst.tick, `emitter.bursts[${index}].tick`, UINT32_MAX),
      count: assertPositiveInteger(burst.count, `emitter.bursts[${index}].count`, 65535)
    });
  }).sort((a, b) => a.tick - b.tick);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].tick === normalized[index].tick) throw new RangeError('Emitter burst ticks must be unique.');
  }
  return Object.freeze(normalized);
}

function normalizeEmitter(definition, materialIds) {
  if (!isPlainObject(definition)) throw new TypeError('Emitter definition must be a plain object.');
  const id = assertUint32(definition.id, 'emitter.id');
  if (id === 0) throw new RangeError('Emitter ID 0 is reserved.');
  const materialId = assertUint32(definition.materialId, 'emitter.materialId');
  if (!materialIds.has(materialId)) throw new RangeError(`Emitter ${id} references unknown material ${materialId}.`);
  const stopTick = definition.stopTick === undefined ? null : assertNonnegativeInteger(definition.stopTick, 'emitter.stopTick', UINT32_MAX);
  const emitter = {
    id,
    materialId,
    startTick: assertNonnegativeInteger(definition.startTick ?? 0, 'emitter.startTick', UINT32_MAX),
    stopTick,
    intervalTicks: assertPositiveInteger(definition.intervalTicks ?? 1, 'emitter.intervalTicks', UINT32_MAX),
    rate: assertNonnegativeInteger(definition.rate ?? 1, 'emitter.rate', 65535),
    bursts: normalizeBursts(definition.bursts),
    geometry: normalizeGeometry(definition.geometry ?? { type: 'point' }),
    velocityXQ16: assertInt32(definition.velocityXQ16 ?? 0, 'emitter.velocityXQ16'),
    velocityYQ16: assertInt32(definition.velocityYQ16 ?? 0, 'emitter.velocityYQ16'),
    velocityJitterQ16: assertNonnegativeInteger(definition.velocityJitterQ16 ?? 0, 'emitter.velocityJitterQ16', MAX_EMITTER_JITTER_Q16)
  };
  if (emitter.stopTick !== null && emitter.stopTick < emitter.startTick) {
    throw new RangeError('emitter.stopTick must be >= emitter.startTick.');
  }
  return Object.freeze(emitter);
}

function normalizeEmitters(emitters, materials) {
  if (!Array.isArray(emitters)) throw new TypeError('emitters must be an array.');
  const materialIds = new Set(materials.map((material) => material.id));
  const normalized = emitters.map((definition) => normalizeEmitter(definition, materialIds)).sort((a, b) => a.id - b.id);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].id === normalized[index].id) throw new RangeError(`Duplicate emitter ID ${normalized[index].id}.`);
  }
  return normalized;
}

export class AgentStore {
  constructor(capacity) {
    this.capacity = assertPositiveInteger(capacity, 'agent capacity', 1_000_000);
    this.length = 0;
    this.active = new Uint8Array(capacity);
    this.emitterId = new Uint32Array(capacity);
    this.materialId = new Uint32Array(capacity);
    this.chunkX = new Int32Array(capacity);
    this.chunkY = new Int32Array(capacity);
    this.localX = new Int32Array(capacity);
    this.localY = new Int32Array(capacity);
    this.velocityXQ16 = new Int32Array(capacity);
    this.velocityYQ16 = new Int32Array(capacity);
    this.ageTicks = new Uint32Array(capacity);
    this.lifetimeTicks = new Uint32Array(capacity);
  }

  allocate(values) {
    for (let index = 0; index < this.capacity; index += 1) {
      if (this.active[index] !== 0) continue;
      const position = normalizeWorldPosition(values.position);
      this.active[index] = 1;
      this.emitterId[index] = assertUint32(values.emitterId, 'agent.emitterId');
      this.materialId[index] = assertUint32(values.materialId, 'agent.materialId');
      this.chunkX[index] = position.chunkX;
      this.chunkY[index] = position.chunkY;
      this.localX[index] = position.localX;
      this.localY[index] = position.localY;
      this.velocityXQ16[index] = clampSpeedComponent(values.velocityXQ16 ?? 0);
      this.velocityYQ16[index] = clampSpeedComponent(values.velocityYQ16 ?? 0);
      this.ageTicks[index] = 0;
      this.lifetimeTicks[index] = assertPositiveInteger(values.lifetimeTicks, 'agent.lifetimeTicks', UINT32_MAX);
      this.length += 1;
      return index + 1;
    }
    return null;
  }

  release(id) {
    const index = this.indexOfActive(id);
    this.active[index] = 0;
    this.length -= 1;
    return true;
  }

  indexOfActive(id) {
    assertUint32(id, 'agent.id');
    if (id === 0 || id > this.capacity || this.active[id - 1] === 0) throw new RangeError(`Unknown active agent ID ${id}.`);
    return id - 1;
  }

  positionAtIndex(index) {
    return Object.freeze({
      chunkX: this.chunkX[index],
      chunkY: this.chunkY[index],
      localX: this.localX[index],
      localY: this.localY[index]
    });
  }

  forEachActiveOrdered(callback) {
    if (typeof callback !== 'function') throw new TypeError('callback must be a function.');
    for (let index = 0; index < this.capacity; index += 1) {
      if (this.active[index] !== 0) callback(index + 1, index);
    }
  }

  toCanonical() {
    const agents = [];
    this.forEachActiveOrdered((id, index) => {
      agents.push({
        id,
        emitterId: this.emitterId[index],
        materialId: this.materialId[index],
        position: this.positionAtIndex(index),
        velocityXQ16: this.velocityXQ16[index],
        velocityYQ16: this.velocityYQ16[index],
        ageTicks: this.ageTicks[index],
        lifetimeTicks: this.lifetimeTicks[index]
      });
    });
    return { capacity: this.capacity, length: this.length, agents };
  }
}

function spawnCountForTick(emitter, tick) {
  if (tick < emitter.startTick || (emitter.stopTick !== null && tick > emitter.stopTick)) return 0;
  let count = ((tick - emitter.startTick) % emitter.intervalTicks === 0) ? emitter.rate : 0;
  for (const burst of emitter.bursts) {
    if (burst.tick === tick) count += burst.count;
    if (burst.tick > tick) break;
  }
  return count;
}

function randomSignedOffset(rng, magnitude) {
  if (magnitude === 0) return 0;
  const bound = magnitude * 2 + 1;
  return rng.nextBounded(bound) - magnitude;
}

function sampleEmitterPosition(emitter, rng) {
  const geometry = emitter.geometry;
  if (geometry.type === 'point') return geometry.origin;
  if (geometry.type === 'mask') {
    const point = geometry.points[rng.nextBounded(geometry.points.length)];
    return translateWorldPosition(geometry.origin, point.xQ16, point.yQ16);
  }
  const offsetX = geometry.widthQ16 === 0 ? 0 : rng.nextBounded(geometry.widthQ16 + 1);
  const offsetY = geometry.heightQ16 === 0 ? 0 : rng.nextBounded(geometry.heightQ16 + 1);
  return translateWorldPosition(geometry.origin, offsetX, offsetY);
}

function materialVelocity(material, velocityXQ16, velocityYQ16, field) {
  let xQ16 = addSaturatedInt32(
    q16ScaleByRatio(velocityXQ16, material.inertiaNumerator, material.inertiaDenominator),
    q16ScaleByRatio(field.xQ16, material.steeringNumerator, material.steeringDenominator)
  );
  let yQ16 = addSaturatedInt32(
    q16ScaleByRatio(velocityYQ16, material.inertiaNumerator, material.inertiaDenominator),
    q16ScaleByRatio(field.yQ16, material.steeringNumerator, material.steeringDenominator)
  );
  xQ16 = clampSpeedComponent(xQ16);
  yQ16 = clampSpeedComponent(yQ16);
  if (material.quantizeAxis) {
    const quantized = quantizeAxisVelocity(xQ16, yQ16);
    xQ16 = quantized.xQ16;
    yQ16 = quantized.yQ16;
  }
  return Object.freeze({ xQ16, yQ16 });
}

export class DeterministicAgentSimulation {
  constructor(options = {}) {
    if (!isPlainObject(options)) throw new TypeError('Simulation options must be a plain object.');
    this.rootSeed = assertUint32(options.rootSeed ?? 0, 'rootSeed');
    this.materials = Object.freeze(normalizeMaterials(options.materials ?? createBaselineMaterials()));
    this.materialById = new Map(this.materials.map((material) => [material.id, material]));
    this.emitters = Object.freeze(normalizeEmitters(options.emitters ?? [], this.materials));
    this.fieldCollection = options.fieldCollection ?? null;
    if (this.fieldCollection !== null && (typeof this.fieldCollection !== 'object' || typeof this.fieldCollection.orderedLayers !== 'function')) {
      throw new TypeError('fieldCollection must be null or expose orderedLayers().');
    }
    this.agents = new AgentStore(options.capacity ?? 4096);
    this.maxDepositions = assertPositiveInteger(options.maxDepositions ?? 1_000_000, 'maxDepositions', 10_000_000);
    this.depositions = [];
    this.tick = 0;
    this.nextDepositionSequence = 0;
    this.totalSpawned = 0;
    this.droppedSpawns = 0;
    this.emitterRuntime = new Map();
    for (const emitter of this.emitters) {
      this.emitterRuntime.set(emitter.id, {
        rng: Xoshiro128StarStar.fromSeed(this.rootSeed, emitter.id),
        spawnOrdinal: 0,
        spawned: 0,
        dropped: 0
      });
    }
  }

  sampleField(position) {
    return this.fieldCollection === null ? ZERO_FIELD : sampleFieldStack(this.fieldCollection, position);
  }

  spawnEmitterTick(emitter) {
    const count = spawnCountForTick(emitter, this.tick);
    const runtime = this.emitterRuntime.get(emitter.id);
    const material = this.materialById.get(emitter.materialId);
    for (let index = 0; index < count; index += 1) {
      const position = sampleEmitterPosition(emitter, runtime.rng);
      const jitter = emitter.velocityJitterQ16;
      const velocityXQ16 = clampSpeedComponent(addSaturatedInt32(emitter.velocityXQ16, randomSignedOffset(runtime.rng, jitter)));
      const velocityYQ16 = clampSpeedComponent(addSaturatedInt32(emitter.velocityYQ16, randomSignedOffset(runtime.rng, jitter)));
      runtime.spawnOrdinal += 1;
      const id = this.agents.allocate({
        emitterId: emitter.id,
        materialId: material.id,
        position,
        velocityXQ16,
        velocityYQ16,
        lifetimeTicks: material.lifetimeTicks
      });
      if (id === null) {
        runtime.dropped += 1;
        this.droppedSpawns += 1;
      } else {
        runtime.spawned += 1;
        this.totalSpawned += 1;
      }
    }
  }

  appendDeposition(agentId, material, from, to) {
    if (this.depositions.length >= this.maxDepositions) {
      throw new RangeError('Canonical deposition capacity exhausted; increase maxDepositions explicitly or stop the run.');
    }
    const agentIndex = this.agents.indexOfActive(agentId);
    this.depositions.push(Object.freeze({
      tick: this.tick,
      sequence: this.nextDepositionSequence,
      agentId,
      emitterId: this.agents.emitterId[agentIndex],
      materialId: material.id,
      materialKind: material.kind,
      primitive: material.primitive,
      from: clonePosition(from),
      to: clonePosition(to),
      radiusQ16: material.radiusQ16,
      strengthQ16: material.strengthQ16
    }));
    this.nextDepositionSequence += 1;
  }

  updateAgents() {
    this.agents.forEachActiveOrdered((id, index) => {
      const material = this.materialById.get(this.agents.materialId[index]);
      const before = this.agents.positionAtIndex(index);
      const field = this.sampleField(before);
      const velocity = materialVelocity(material, this.agents.velocityXQ16[index], this.agents.velocityYQ16[index], field);
      const after = translateWorldPosition(before, velocity.xQ16, velocity.yQ16);
      this.agents.velocityXQ16[index] = velocity.xQ16;
      this.agents.velocityYQ16[index] = velocity.yQ16;
      this.agents.chunkX[index] = after.chunkX;
      this.agents.chunkY[index] = after.chunkY;
      this.agents.localX[index] = after.localX;
      this.agents.localY[index] = after.localY;
      const age = this.agents.ageTicks[index];
      if (age % material.depositEvery === 0) this.appendDeposition(id, material, before, after);
      this.agents.ageTicks[index] = age + 1;
      if (this.agents.ageTicks[index] >= this.agents.lifetimeTicks[index]) this.agents.release(id);
    });
  }

  step() {
    for (const emitter of this.emitters) this.spawnEmitterTick(emitter);
    this.updateAgents();
    this.tick += 1;
    return this.tick;
  }

  runTicks(count) {
    assertNonnegativeInteger(count, 'count', UINT32_MAX);
    for (let index = 0; index < count; index += 1) this.step();
    return this.tick;
  }

  canonicalState() {
    const emitters = this.emitters.map((emitter) => {
      const runtime = this.emitterRuntime.get(emitter.id);
      return {
        id: emitter.id,
        spawnOrdinal: runtime.spawnOrdinal,
        spawned: runtime.spawned,
        dropped: runtime.dropped,
        rng: runtime.rng.snapshot()
      };
    });
    return {
      version: SIMULATION_VERSION,
      rootSeed: this.rootSeed,
      tick: this.tick,
      totalSpawned: this.totalSpawned,
      droppedSpawns: this.droppedSpawns,
      agents: this.agents.toCanonical(),
      emitters
    };
  }

  stateHash() {
    return canonicalHash(this.canonicalState());
  }

  depositionHash() {
    return canonicalHash({ version: SIMULATION_VERSION, depositions: this.depositions });
  }

  resultHash() {
    return canonicalHash({ version: SIMULATION_VERSION, state: this.canonicalState(), depositions: this.depositions });
  }
}
