import { canonicalHash, canonicalStringify } from './canonical.js';
import { UINT32_MAX, assertUint32 } from './numeric.js';
import { Xoshiro128StarStar, deriveSeed } from './prng.js';
import { CanonicalSoATable } from './soa.js';

export const CANONICAL_ENGINE_VERSION = 'fw-canonical-v1';
const KERNEL_STREAM_DOMAIN = 0x4b45524e; // ASCII-ish "KERN" domain separator.

function normalizeTableDefinition(definition, index) {
  if (definition === null || typeof definition !== 'object') {
    throw new TypeError(`tables[${index}] must be an object.`);
  }
  const { name, schema, capacity, initialRows = [] } = definition;
  if (typeof name !== 'string' || !/^[a-z][a-z0-9_-]*$/u.test(name)) {
    throw new RangeError(`tables[${index}].name must be a stable lowercase identifier.`);
  }
  if (!Array.isArray(initialRows)) {
    throw new TypeError(`tables[${index}].initialRows must be an array.`);
  }
  return Object.freeze({ name, schema: { ...schema }, capacity, initialRows: initialRows.map((row) => ({ ...row })) });
}

export class DeterministicSimulationKernel {
  #definitions;
  #tables;
  #rng;
  #tickHandler;

  constructor({ rootSeed, streamId = 0, tables = [], tickHandler = null }) {
    this.rootSeed = assertUint32(rootSeed, 'rootSeed');
    this.streamId = assertUint32(streamId, 'streamId');
    if (!Array.isArray(tables)) throw new TypeError('tables must be an array.');
    if (tickHandler !== null && typeof tickHandler !== 'function') {
      throw new TypeError('tickHandler must be a function or null.');
    }

    this.#definitions = Object.freeze(tables.map(normalizeTableDefinition).sort((a, b) => (a.name === b.name ? 0 : (a.name < b.name ? -1 : 1))));
    for (let index = 1; index < this.#definitions.length; index += 1) {
      if (this.#definitions[index - 1].name === this.#definitions[index].name) {
        throw new RangeError(`Duplicate canonical table name: ${this.#definitions[index].name}`);
      }
    }
    this.#tickHandler = tickHandler;
    this.reset();
  }

  get tick() {
    return this.currentTick;
  }

  table(name) {
    const table = this.#tables.get(name);
    if (!table) throw new RangeError(`Unknown canonical table: ${name}`);
    return table;
  }

  advanceOne() {
    if (this.currentTick === UINT32_MAX) {
      throw new RangeError('Canonical tick counter exhausted uint32 range.');
    }

    const fromTick = this.currentTick;
    const toTick = fromTick + 1;
    if (this.#tickHandler) {
      this.#tickHandler(Object.freeze({
        fromTick,
        toTick,
        randomUint32: () => this.#rng.nextUint32(),
        table: (name) => this.table(name)
      }));
    }
    this.currentTick = toTick;
    return this.currentTick;
  }

  advanceMany(count) {
    assertUint32(count, 'count');
    if (BigInt(this.currentTick) + BigInt(count) > BigInt(UINT32_MAX)) {
      throw new RangeError('Canonical tick counter would overflow uint32 range.');
    }
    for (let index = 0; index < count; index += 1) {
      this.advanceOne();
    }
    return this.currentTick;
  }

  reset() {
    this.currentTick = 0;
    const kernelSeed = deriveSeed(this.rootSeed, this.streamId, KERNEL_STREAM_DOMAIN);
    this.#rng = Xoshiro128StarStar.fromSeed(kernelSeed, this.streamId);
    this.#tables = new Map();

    for (const definition of this.#definitions) {
      const table = new CanonicalSoATable(definition.schema, definition.capacity);
      for (const row of definition.initialRows) {
        table.create(row);
      }
      this.#tables.set(definition.name, table);
    }

    return this.hash();
  }

  snapshot() {
    return Object.freeze({
      engineVersion: CANONICAL_ENGINE_VERSION,
      rootSeed: this.rootSeed,
      streamId: this.streamId,
      tick: this.currentTick,
      rng: this.#rng.snapshot(),
      tables: this.#definitions.map(({ name }) => Object.freeze({
        name,
        state: this.#tables.get(name).snapshot()
      }))
    });
  }

  serialize() {
    return canonicalStringify(this.snapshot());
  }

  hash() {
    return canonicalHash(this.snapshot());
  }
}
