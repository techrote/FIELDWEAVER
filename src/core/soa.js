import { UINT32_MAX, assertInt32, assertUint32 } from './numeric.js';

const COLUMN_TYPES = Object.freeze({
  i32: Object.freeze({ Constructor: Int32Array, validate: assertInt32 }),
  u32: Object.freeze({ Constructor: Uint32Array, validate: assertUint32 })
});

function normalizeSchema(schema) {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new TypeError('SoA schema must be an object mapping column names to i32/u32 types.');
  }

  const names = Object.keys(schema).sort();
  if (names.length === 0) {
    throw new RangeError('SoA schema must define at least one column.');
  }

  return Object.freeze(names.map((name) => {
    const type = schema[name];
    if (!Object.hasOwn(COLUMN_TYPES, type)) {
      throw new RangeError(`Unsupported SoA column type for ${name}: ${type}`);
    }
    return Object.freeze({ name, type });
  }));
}

export class CanonicalSoATable {
  #schema;
  #ids;
  #columns;
  #length = 0;
  #nextId = 1;

  constructor(schema, capacity) {
    if (!Number.isInteger(capacity) || capacity <= 0 || capacity > UINT32_MAX) {
      throw new RangeError('SoA capacity must be an integer in [1, 2^32-1].');
    }

    this.capacity = capacity;
    this.#schema = normalizeSchema(schema);
    this.#ids = new Uint32Array(capacity);
    this.#columns = Object.create(null);

    for (const definition of this.#schema) {
      const { Constructor } = COLUMN_TYPES[definition.type];
      this.#columns[definition.name] = new Constructor(capacity);
    }
  }

  get length() {
    return this.#length;
  }

  get nextId() {
    return this.#nextId;
  }

  get schema() {
    return this.#schema;
  }

  create(values = {}) {
    if (this.#length >= this.capacity) {
      throw new RangeError('SoA capacity exhausted.');
    }
    if (this.#nextId > UINT32_MAX) {
      throw new RangeError('Stable ID space exhausted.');
    }

    const index = this.#length;
    const id = this.#nextId;
    this.#ids[index] = id;

    for (const definition of this.#schema) {
      const raw = Object.hasOwn(values, definition.name) ? values[definition.name] : 0;
      this.#columns[definition.name][index] = COLUMN_TYPES[definition.type].validate(raw, definition.name);
    }

    for (const key of Object.keys(values)) {
      if (!this.#schema.some((definition) => definition.name === key)) {
        throw new RangeError(`Unknown SoA column: ${key}`);
      }
    }

    this.#length += 1;
    this.#nextId += 1;
    return id;
  }

  #indexOf(id) {
    assertUint32(id, 'id');
    if (id === 0 || id >= this.#nextId) {
      throw new RangeError(`Unknown stable ID ${id}.`);
    }
    return id - 1;
  }

  get(id, column) {
    const index = this.#indexOf(id);
    const data = this.#columns[column];
    if (!data) throw new RangeError(`Unknown SoA column: ${column}`);
    return data[index];
  }

  set(id, column, value) {
    const index = this.#indexOf(id);
    const definition = this.#schema.find((item) => item.name === column);
    if (!definition) throw new RangeError(`Unknown SoA column: ${column}`);
    this.#columns[column][index] = COLUMN_TYPES[definition.type].validate(value, column);
  }

  ids() {
    return this.#ids.slice(0, this.#length);
  }

  forEachOrdered(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('forEachOrdered callback must be a function.');
    }
    for (let index = 0; index < this.#length; index += 1) {
      callback(this.#ids[index], index);
    }
  }

  snapshot() {
    const columns = Object.create(null);
    for (const definition of this.#schema) {
      columns[definition.name] = this.#columns[definition.name].slice(0, this.#length);
    }

    return Object.freeze({
      capacity: this.capacity,
      length: this.#length,
      nextId: this.#nextId,
      schema: this.#schema.map((definition) => ({ ...definition })),
      ids: this.ids(),
      columns
    });
  }

  static fromSnapshot(snapshot) {
    const schema = Object.fromEntries(snapshot.schema.map(({ name, type }) => [name, type]));
    const table = new CanonicalSoATable(schema, snapshot.capacity);

    for (let index = 0; index < snapshot.length; index += 1) {
      const values = Object.create(null);
      for (const definition of snapshot.schema) {
        values[definition.name] = snapshot.columns[definition.name][index];
      }
      const id = table.create(values);
      if (id !== snapshot.ids[index]) {
        throw new RangeError('Snapshot stable IDs are not canonical monotonic IDs.');
      }
    }

    if (table.nextId !== snapshot.nextId) {
      throw new RangeError('Snapshot nextId does not match canonical monotonic allocation.');
    }
    return table;
  }
}
