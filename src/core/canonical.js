function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function serialize(value, path) {
  if (value === null) return 'null';

  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`${path} must be a safe integer for canonical serialization.`);
    }
    return String(value);
  }

  if (typeof value === 'string') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((item, index) => serialize(item, `${path}[${index}]`)).join(',')}]`;
  }

  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return serialize({
      $type: value.constructor.name,
      values: Array.from(value)
    }, path);
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(value[key], `${path}.${key}`)}`).join(',')}}`;
  }

  throw new TypeError(`${path} contains unsupported canonical value type ${typeof value}.`);
}

export function canonicalStringify(value) {
  return serialize(value, '$');
}

export function fnv1a64(text) {
  if (typeof text !== 'string') {
    throw new TypeError('fnv1a64 input must be a string.');
  }

  const bytes = new TextEncoder().encode(text);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }

  return hash.toString(16).padStart(16, '0');
}

export function canonicalHash(value) {
  return fnv1a64(canonicalStringify(value));
}
