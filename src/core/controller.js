import { UINT32_MAX, assertUint32 } from './numeric.js';

function greatestCommonDivisor(a, b) {
  let x = a;
  let y = b;
  while (y !== 0) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x;
}

export class FixedStepController {
  #kernel;
  #running = false;
  #speedNumerator = 1;
  #speedDenominator = 1;
  #remainder = 0n;

  constructor(kernel) {
    if (!kernel || typeof kernel.advanceMany !== 'function' || typeof kernel.reset !== 'function') {
      throw new TypeError('FixedStepController requires a deterministic simulation kernel.');
    }
    this.#kernel = kernel;
  }

  get running() {
    return this.#running;
  }

  get speed() {
    return Object.freeze({ numerator: this.#speedNumerator, denominator: this.#speedDenominator });
  }

  run() {
    this.#running = true;
  }

  pause() {
    this.#running = false;
  }

  setSpeed(numerator, denominator = 1) {
    assertUint32(numerator, 'numerator');
    assertUint32(denominator, 'denominator');
    if (numerator === 0 || denominator === 0) {
      throw new RangeError('Speed numerator and denominator must both be greater than zero.');
    }

    const divisor = greatestCommonDivisor(numerator, denominator);
    this.#speedNumerator = numerator / divisor;
    this.#speedDenominator = denominator / divisor;
    this.#remainder = 0n;
    return this.speed;
  }

  schedule(baseTickBudget = 1) {
    assertUint32(baseTickBudget, 'baseTickBudget');
    if (!this.#running || baseTickBudget === 0) return 0;

    const accumulated = this.#remainder + BigInt(baseTickBudget) * BigInt(this.#speedNumerator);
    const ticks = accumulated / BigInt(this.#speedDenominator);
    this.#remainder = accumulated % BigInt(this.#speedDenominator);

    if (ticks > BigInt(UINT32_MAX)) {
      throw new RangeError('Scheduled tick batch exceeds uint32 range.');
    }
    const count = Number(ticks);
    this.#kernel.advanceMany(count);
    return count;
  }

  singleStep() {
    this.#kernel.advanceMany(1);
    return this.#kernel.tick;
  }

  multiStep(count) {
    this.#kernel.advanceMany(assertUint32(count, 'count'));
    return this.#kernel.tick;
  }

  reset() {
    this.pause();
    this.#remainder = 0n;
    return this.#kernel.reset();
  }
}
