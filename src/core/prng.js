import { assertUint32 } from './numeric.js';

function rotl32(value, shift) {
  const amount = shift & 31;
  return ((value << amount) | (value >>> (32 - amount))) >>> 0;
}

export function mix32(value) {
  let x = assertUint32(value, 'value');
  x = (x + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return (x ^ (x >>> 15)) >>> 0;
}

export function deriveSeed(rootSeed, ...stableParts) {
  let mixed = mix32((assertUint32(rootSeed, 'rootSeed') ^ 0x6a09e667) >>> 0);
  for (const [index, part] of stableParts.entries()) {
    const stable = assertUint32(part, `stableParts[${index}]`);
    mixed = mix32((mixed ^ stable ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
  }
  return mixed >>> 0;
}

export class Xoshiro128StarStar {
  #state;

  constructor(state) {
    if (!Array.isArray(state) || state.length !== 4) {
      throw new TypeError('xoshiro128** state must contain exactly four uint32 words.');
    }
    this.#state = Uint32Array.from(state.map((value, index) => assertUint32(value, `state[${index}]`)));
    if (this.#state.every((value) => value === 0)) {
      throw new RangeError('xoshiro128** all-zero state is invalid.');
    }
  }

  static fromSeed(seed, streamId = 0) {
    const root = deriveSeed(assertUint32(seed, 'seed'), assertUint32(streamId, 'streamId'));
    const state = [];
    let cursor = root;
    for (let index = 0; index < 4; index += 1) {
      cursor = mix32((cursor + Math.imul(index + 1, 0x85ebca6b)) >>> 0);
      state.push(cursor);
    }
    if (state.every((value) => value === 0)) {
      state[0] = 0x6d2b79f5;
    }
    return new Xoshiro128StarStar(state);
  }

  nextUint32() {
    const state = this.#state;
    const result = Math.imul(rotl32(Math.imul(state[1], 5) >>> 0, 7), 9) >>> 0;
    const temporary = (state[1] << 9) >>> 0;

    state[2] ^= state[0];
    state[3] ^= state[1];
    state[1] ^= state[2];
    state[0] ^= state[3];
    state[2] ^= temporary;
    state[3] = rotl32(state[3], 11);

    return result;
  }

  nextBounded(boundExclusive) {
    assertUint32(boundExclusive, 'boundExclusive');
    if (boundExclusive === 0) {
      throw new RangeError('boundExclusive must be greater than zero.');
    }

    const threshold = (0x100000000 % boundExclusive) >>> 0;
    while (true) {
      const value = this.nextUint32();
      if (value >= threshold) {
        return value % boundExclusive;
      }
    }
  }

  snapshot() {
    return Object.freeze(Array.from(this.#state));
  }

  clone() {
    return new Xoshiro128StarStar(this.snapshot());
  }
}
