import { canonicalHash } from '../core/canonical.js';
import { CHUNK_SPAN_Q16, translateWorldPosition } from '../core/coordinates.js';
import { INT32_MAX, INT32_MIN, Q16_ONE, assertInt32 } from '../core/numeric.js';
import { DeterministicAgentSimulation, MAX_STEP_DISPLACEMENT_Q16, SIMULATION_VERSION } from './model.js';

export const GPU_RESEARCH_VERSION = 'fw-gpu-research-v1';
export const GPU_TRANSLATION_KERNEL_VERSION = 'fw-gpu-translate-v1';
export const GPU_TRANSLATION_INPUT_STRIDE = 6;
export const GPU_TRANSLATION_OUTPUT_STRIDE = 5;
export const GPU_TRANSLATION_WORKGROUP_SIZE = 64;
export const CANONICAL_GPU_ACCELERATION_ENABLED = false;

const STATUS_OK = 0;
const STATUS_CHUNK_OVERFLOW = 1;

function assertPackedTranslationInput(input) {
  if (!(input instanceof Int32Array)) throw new TypeError('translation input must be an Int32Array.');
  if (input.length % GPU_TRANSLATION_INPUT_STRIDE !== 0) {
    throw new RangeError(`translation input length must be a multiple of ${GPU_TRANSLATION_INPUT_STRIDE}.`);
  }
  for (let offset = 0; offset < input.length; offset += GPU_TRANSLATION_INPUT_STRIDE) {
    const localX = input[offset + 2];
    const localY = input[offset + 3];
    const deltaX = input[offset + 4];
    const deltaY = input[offset + 5];
    if (localX < 0 || localX >= CHUNK_SPAN_Q16 || localY < 0 || localY >= CHUNK_SPAN_Q16) {
      throw new RangeError('translation input local coordinates must already be normalized.');
    }
    if (Math.abs(deltaX) > MAX_STEP_DISPLACEMENT_Q16 || Math.abs(deltaY) > MAX_STEP_DISPLACEMENT_Q16) {
      throw new RangeError(`translation deltas must stay within canonical step bound ${MAX_STEP_DISPLACEMENT_Q16}.`);
    }
  }
  return input.length / GPU_TRANSLATION_INPUT_STRIDE;
}

export function packTranslationRecords(records) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array.');
  const packed = new Int32Array(records.length * GPU_TRANSLATION_INPUT_STRIDE);
  records.forEach((record, index) => {
    if (record === null || typeof record !== 'object') throw new TypeError(`records[${index}] must be an object.`);
    const base = index * GPU_TRANSLATION_INPUT_STRIDE;
    packed[base] = assertInt32(record.chunkX, `records[${index}].chunkX`);
    packed[base + 1] = assertInt32(record.chunkY, `records[${index}].chunkY`);
    packed[base + 2] = assertInt32(record.localX, `records[${index}].localX`);
    packed[base + 3] = assertInt32(record.localY, `records[${index}].localY`);
    packed[base + 4] = assertInt32(record.deltaXQ16, `records[${index}].deltaXQ16`);
    packed[base + 5] = assertInt32(record.deltaYQ16, `records[${index}].deltaYQ16`);
  });
  assertPackedTranslationInput(packed);
  return packed;
}

export function unpackTranslationOutput(output) {
  if (!(output instanceof Int32Array)) throw new TypeError('translation output must be an Int32Array.');
  if (output.length % GPU_TRANSLATION_OUTPUT_STRIDE !== 0) {
    throw new RangeError(`translation output length must be a multiple of ${GPU_TRANSLATION_OUTPUT_STRIDE}.`);
  }
  const records = [];
  for (let offset = 0; offset < output.length; offset += GPU_TRANSLATION_OUTPUT_STRIDE) {
    records.push(Object.freeze({
      chunkX: output[offset],
      chunkY: output[offset + 1],
      localX: output[offset + 2],
      localY: output[offset + 3],
      status: output[offset + 4]
    }));
  }
  return Object.freeze(records);
}

export function translatePackedCpu(input) {
  const count = assertPackedTranslationInput(input);
  const output = new Int32Array(count * GPU_TRANSLATION_OUTPUT_STRIDE);
  for (let index = 0; index < count; index += 1) {
    const inputBase = index * GPU_TRANSLATION_INPUT_STRIDE;
    const outputBase = index * GPU_TRANSLATION_OUTPUT_STRIDE;
    try {
      const position = translateWorldPosition({
        chunkX: input[inputBase],
        chunkY: input[inputBase + 1],
        localX: input[inputBase + 2],
        localY: input[inputBase + 3]
      }, input[inputBase + 4], input[inputBase + 5]);
      output[outputBase] = position.chunkX;
      output[outputBase + 1] = position.chunkY;
      output[outputBase + 2] = position.localX;
      output[outputBase + 3] = position.localY;
      output[outputBase + 4] = STATUS_OK;
    } catch (error) {
      if (!(error instanceof RangeError) || !/chunk coordinate overflowed/.test(error.message)) throw error;
      output[outputBase] = input[inputBase];
      output[outputBase + 1] = input[inputBase + 1];
      output[outputBase + 2] = input[inputBase + 2];
      output[outputBase + 3] = input[inputBase + 3];
      output[outputBase + 4] = STATUS_CHUNK_OVERFLOW;
    }
  }
  return output;
}

export class CpuTranslationCandidate {
  constructor() {
    this.kind = 'cpu-reference';
    this.available = true;
    this.environment = Object.freeze({ api: 'javascript', implementation: 'canonical translateWorldPosition' });
  }

  async translate(input) {
    return translatePackedCpu(input);
  }
}

const WGSL_TRANSLATION_SHADER = `
struct Params {
  count: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
}

@group(0) @binding(0) var<storage, read> inputData: array<i32>;
@group(0) @binding(1) var<storage, read_write> outputData: array<i32>;
@group(0) @binding(2) var<uniform> params: Params;

const INPUT_STRIDE: u32 = 6u;
const OUTPUT_STRIDE: u32 = 5u;
const CHUNK_SPAN: i32 = 16777216i;
const INT_MAX: i32 = 2147483647i;
const INT_MIN: i32 = -2147483647i - 1i;

fn translateAxis(chunk: i32, local: i32, delta: i32) -> vec3<i32> {
  let sum = local + delta;
  var quotient = sum / CHUNK_SPAN;
  var remainder = sum % CHUNK_SPAN;
  if (remainder < 0i) {
    quotient = quotient - 1i;
    remainder = remainder + CHUNK_SPAN;
  }
  var overflow = 0i;
  if ((quotient > 0i && chunk > INT_MAX - quotient) ||
      (quotient < 0i && chunk < INT_MIN - quotient)) {
    overflow = 1i;
  }
  var nextChunk = chunk;
  if (overflow == 0i) {
    nextChunk = chunk + quotient;
  }
  return vec3<i32>(nextChunk, remainder, overflow);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let index = globalId.x;
  if (index >= params.count) {
    return;
  }
  let inputBase = index * INPUT_STRIDE;
  let outputBase = index * OUTPUT_STRIDE;
  let x = translateAxis(inputData[inputBase], inputData[inputBase + 2u], inputData[inputBase + 4u]);
  let y = translateAxis(inputData[inputBase + 1u], inputData[inputBase + 3u], inputData[inputBase + 5u]);
  let overflow = max(x.z, y.z);
  outputData[outputBase] = x.x;
  outputData[outputBase + 1u] = y.x;
  outputData[outputBase + 2u] = x.y;
  outputData[outputBase + 3u] = y.y;
  outputData[outputBase + 4u] = overflow;
}
`;

function adapterEnvironment(adapter, device) {
  const info = adapter?.info ?? {};
  return Object.freeze({
    api: 'webgpu',
    vendor: info.vendor ?? null,
    architecture: info.architecture ?? null,
    device: info.device ?? null,
    description: info.description ?? null,
    maxStorageBufferBindingSize: Number(device?.limits?.maxStorageBufferBindingSize ?? 0),
    maxComputeWorkgroupsPerDimension: Number(device?.limits?.maxComputeWorkgroupsPerDimension ?? 0)
  });
}

export class WebGpuTranslationCandidate {
  constructor(device, pipeline, environment, globals) {
    this.kind = 'webgpu-translation-prototype';
    this.available = true;
    this.device = device;
    this.pipeline = pipeline;
    this.environment = environment;
    this.globals = globals;
  }

  async translate(input) {
    const count = assertPackedTranslationInput(input);
    if (count === 0) return new Int32Array(0);
    const { GPUBufferUsage, GPUMapMode } = this.globals;
    const outputBytes = count * GPU_TRANSLATION_OUTPUT_STRIDE * Int32Array.BYTES_PER_ELEMENT;
    const inputBuffer = this.device.createBuffer({
      size: input.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    const outputBuffer = this.device.createBuffer({
      size: outputBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    const readBuffer = this.device.createBuffer({
      size: outputBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    const paramsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    try {
      this.device.queue.writeBuffer(inputBuffer, 0, input);
      this.device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([count, 0, 0, 0]));
      const bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: inputBuffer } },
          { binding: 1, resource: { buffer: outputBuffer } },
          { binding: 2, resource: { buffer: paramsBuffer } }
        ]
      });
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(count / GPU_TRANSLATION_WORKGROUP_SIZE));
      pass.end();
      encoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, outputBytes);
      this.device.queue.submit([encoder.finish()]);
      await readBuffer.mapAsync(GPUMapMode.READ);
      return new Int32Array(readBuffer.getMappedRange().slice(0));
    } finally {
      try { readBuffer.unmap(); } catch { /* not mapped after a device failure */ }
      inputBuffer.destroy();
      outputBuffer.destroy();
      readBuffer.destroy();
      paramsBuffer.destroy();
    }
  }

  destroy() {
    this.device.destroy?.();
  }
}

export async function createWebGpuTranslationCandidate(navigatorLike = globalThis.navigator) {
  const gpu = navigatorLike?.gpu;
  const GPUBufferUsage = globalThis.GPUBufferUsage;
  const GPUMapMode = globalThis.GPUMapMode;
  if (!gpu?.requestAdapter) {
    return Object.freeze({ available: false, kind: 'webgpu-translation-prototype', reason: 'navigator.gpu unavailable' });
  }
  if (!GPUBufferUsage || !GPUMapMode) {
    return Object.freeze({ available: false, kind: 'webgpu-translation-prototype', reason: 'WebGPU buffer globals unavailable' });
  }
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    return Object.freeze({ available: false, kind: 'webgpu-translation-prototype', reason: 'requestAdapter returned null' });
  }
  let device;
  try {
    device = await adapter.requestDevice();
    const shader = device.createShaderModule({ code: WGSL_TRANSLATION_SHADER });
    if (typeof shader.getCompilationInfo === 'function') {
      const info = await shader.getCompilationInfo();
      const errors = info.messages.filter((message) => message.type === 'error');
      if (errors.length > 0) {
        device.destroy?.();
        return Object.freeze({
          available: false,
          kind: 'webgpu-translation-prototype',
          reason: `WGSL compilation failed: ${errors.map((message) => message.message).join(' | ')}`
        });
      }
    }
    const descriptor = { layout: 'auto', compute: { module: shader, entryPoint: 'main' } };
    const pipeline = typeof device.createComputePipelineAsync === 'function'
      ? await device.createComputePipelineAsync(descriptor)
      : device.createComputePipeline(descriptor);
    return new WebGpuTranslationCandidate(device, pipeline, adapterEnvironment(adapter, device), { GPUBufferUsage, GPUMapMode });
  } catch (error) {
    device?.destroy?.();
    return Object.freeze({
      available: false,
      kind: 'webgpu-translation-prototype',
      reason: `WebGPU initialization failed: ${error instanceof Error ? error.message : String(error)}`
    });
  }
}

function currentTickDepositions(simulation, startIndex) {
  return simulation.depositions.slice(startIndex);
}

function cloneCanonical(value) {
  if (Array.isArray(value)) return value.map(cloneCanonical);
  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const [key, child] of Object.entries(value)) result[key] = cloneCanonical(child);
    return result;
  }
  return value;
}

function outputPosition(output, index) {
  const base = index * GPU_TRANSLATION_OUTPUT_STRIDE;
  if (output[base + 4] !== STATUS_OK) throw new RangeError(`candidate translation ${index} reported status ${output[base + 4]}.`);
  return Object.freeze({
    chunkX: output[base],
    chunkY: output[base + 1],
    localX: output[base + 2],
    localY: output[base + 3]
  });
}

function makeConformanceSimulation() {
  return new DeterministicAgentSimulation({
    rootSeed: 0x15c0ffee,
    capacity: 1024,
    maxDepositions: 100_000,
    emitters: [{
      id: 1,
      materialId: 1,
      startTick: 0,
      stopTick: 7,
      intervalTicks: 1,
      rate: 12,
      geometry: {
        type: 'box',
        origin: { chunkX: -2, chunkY: 3, localX: CHUNK_SPAN_Q16 - (2 * Q16_ONE), localY: Q16_ONE },
        widthQ16: Q16_ONE,
        heightQ16: Q16_ONE
      },
      velocityXQ16: 3 * Q16_ONE,
      velocityYQ16: -2 * Q16_ONE,
      velocityJitterQ16: Q16_ONE / 8
    }]
  });
}

export async function runTranslationShadowConformance(candidate, options = {}) {
  if (!candidate || candidate.available !== true || typeof candidate.translate !== 'function') {
    throw new TypeError('candidate must be an available translation candidate.');
  }
  const ticks = options.ticks ?? 12;
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > 32) throw new RangeError('conformance ticks must be in [1, 32].');
  const simulation = makeConformanceSimulation();
  const shadowDepositions = [];
  const checkpoints = [];

  for (let tick = 0; tick < ticks; tick += 1) {
    const depositionStart = simulation.depositions.length;
    simulation.step();
    const state = simulation.canonicalState();
    const newDepositions = currentTickDepositions(simulation, depositionStart);
    const depositionByAgent = new Map(newDepositions.map((entry) => [entry.agentId, entry]));
    const records = state.agents.agents.map((agent) => {
      const deposition = depositionByAgent.get(agent.id);
      if (!deposition) throw new Error(`conformance scenario missing deposition for active agent ${agent.id} at tick ${tick}.`);
      return {
        ...deposition.from,
        deltaXQ16: agent.velocityXQ16,
        deltaYQ16: agent.velocityYQ16
      };
    });
    const output = await candidate.translate(packTranslationRecords(records));
    if (!(output instanceof Int32Array) || output.length !== records.length * GPU_TRANSLATION_OUTPUT_STRIDE) {
      throw new Error(`candidate returned invalid output length at tick ${tick}.`);
    }
    const positionByAgent = new Map();
    state.agents.agents.forEach((agent, index) => positionByAgent.set(agent.id, outputPosition(output, index)));

    for (const deposition of newDepositions) {
      const translated = positionByAgent.get(deposition.agentId);
      shadowDepositions.push(Object.freeze({ ...deposition, to: translated }));
    }
    const shadowState = cloneCanonical(state);
    for (const agent of shadowState.agents.agents) agent.position = positionByAgent.get(agent.id);
    const candidateStateHash = canonicalHash(shadowState);
    const candidateDepositionHash = canonicalHash({ version: SIMULATION_VERSION, depositions: shadowDepositions });
    const expectedStateHash = simulation.stateHash();
    const expectedDepositionHash = simulation.depositionHash();
    const checkpoint = Object.freeze({
      tick: simulation.tick,
      activeAgents: state.agents.length,
      stateHash: expectedStateHash,
      depositionHash: expectedDepositionHash,
      stateEquivalent: candidateStateHash === expectedStateHash,
      depositionEquivalent: candidateDepositionHash === expectedDepositionHash
    });
    checkpoints.push(checkpoint);
    if (!checkpoint.stateEquivalent || !checkpoint.depositionEquivalent) {
      return Object.freeze({
        version: GPU_RESEARCH_VERSION,
        kernel: GPU_TRANSLATION_KERNEL_VERSION,
        passed: false,
        candidate: candidate.kind,
        environment: candidate.environment ?? null,
        checkpoints: Object.freeze(checkpoints),
        failure: checkpoint
      });
    }
  }

  return Object.freeze({
    version: GPU_RESEARCH_VERSION,
    kernel: GPU_TRANSLATION_KERNEL_VERSION,
    passed: true,
    candidate: candidate.kind,
    environment: candidate.environment ?? null,
    checkpoints: Object.freeze(checkpoints),
    finalStateHash: simulation.stateHash(),
    finalDepositionHash: simulation.depositionHash(),
    finalResultHash: simulation.resultHash()
  });
}

function benchmarkWorkload(count) {
  const records = [];
  for (let index = 0; index < count; index += 1) {
    const edge = index % 4;
    records.push({
      chunkX: (index % 1024) - 512,
      chunkY: ((index * 7) % 1024) - 512,
      localX: edge === 0 ? CHUNK_SPAN_Q16 - Q16_ONE : (index * 977) % CHUNK_SPAN_Q16,
      localY: edge === 1 ? 0 : (index * 541) % CHUNK_SPAN_Q16,
      deltaXQ16: edge === 0 ? 3 * Q16_ONE : ((index % 9) - 4) * (Q16_ONE / 2),
      deltaYQ16: edge === 1 ? -3 * Q16_ONE : (((index * 5) % 9) - 4) * (Q16_ONE / 2)
    });
  }
  return packTranslationRecords(records);
}

function monotonicNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  const round = (value) => Math.round(value * 1000) / 1000;
  return Object.freeze({ minMs: round(sorted[0]), medianMs: round(median), maxMs: round(sorted.at(-1)) });
}

export async function benchmarkTranslationCandidate(candidate, options = {}) {
  if (!candidate || candidate.available !== true || typeof candidate.translate !== 'function') {
    throw new TypeError('candidate must be an available translation candidate.');
  }
  const sizes = options.sizes ?? [1024, 8192, 30_000];
  const repeats = options.repeats ?? 7;
  const warmups = options.warmups ?? 2;
  if (!Number.isInteger(repeats) || repeats < 3 || repeats > 25) throw new RangeError('repeats must be in [3, 25].');
  if (!Number.isInteger(warmups) || warmups < 0 || warmups > 10) throw new RangeError('warmups must be in [0, 10].');
  const results = [];

  for (const count of sizes) {
    if (!Number.isInteger(count) || count < 1 || count > 1_000_000) throw new RangeError('benchmark sizes must be in [1, 1000000].');
    const input = benchmarkWorkload(count);
    const expected = translatePackedCpu(input);
    for (let index = 0; index < warmups; index += 1) await candidate.translate(input);
    const cpuSamples = [];
    const candidateSamples = [];
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      let started = monotonicNow();
      translatePackedCpu(input);
      cpuSamples.push(monotonicNow() - started);
      started = monotonicNow();
      const actual = await candidate.translate(input);
      candidateSamples.push(monotonicNow() - started);
      if (actual.length !== expected.length) throw new Error(`candidate benchmark output length mismatch for ${count} records.`);
      for (let index = 0; index < actual.length; index += 1) {
        if (actual[index] !== expected[index]) throw new Error(`candidate benchmark mismatch for ${count} records at scalar ${index}.`);
      }
    }
    results.push(Object.freeze({ count, cpu: summarize(cpuSamples), candidate: summarize(candidateSamples) }));
  }
  return Object.freeze({
    version: GPU_RESEARCH_VERSION,
    kernel: GPU_TRANSLATION_KERNEL_VERSION,
    candidate: candidate.kind,
    environment: candidate.environment ?? null,
    timingBoundary: 'candidate timing includes upload, command encoding/submission, GPU execution, readback mapping, and synchronization',
    results: Object.freeze(results)
  });
}

export async function evaluateCanonicalGpuAcceleration(options = {}) {
  const candidate = options.candidate ?? await createWebGpuTranslationCandidate(options.navigatorLike ?? globalThis.navigator);
  if (!candidate || candidate.available !== true) {
    return Object.freeze({
      backend: 'cpu',
      canonical: true,
      candidateAvailable: false,
      candidateConformant: false,
      reason: candidate?.reason ?? 'GPU candidate unavailable'
    });
  }
  let conformance;
  try {
    conformance = await runTranslationShadowConformance(candidate, options.conformance);
  } catch (error) {
    return Object.freeze({
      backend: 'cpu',
      canonical: true,
      candidateAvailable: true,
      candidateConformant: false,
      reason: `GPU candidate self-test failed: ${error instanceof Error ? error.message : String(error)}`
    });
  }
  if (!conformance.passed) {
    return Object.freeze({
      backend: 'cpu',
      canonical: true,
      candidateAvailable: true,
      candidateConformant: false,
      reason: `GPU candidate diverged at checkpoint tick ${conformance.failure.tick}`,
      conformance
    });
  }
  return Object.freeze({
    backend: 'cpu',
    canonical: true,
    candidateAvailable: true,
    candidateConformant: true,
    reason: 'FW-015 does not enable canonical GPU execution: only position translation is covered, fixed-point field/material arithmetic still requires wider intermediates, and transfer/synchronization costs are workload-dependent.',
    conformance
  });
}

export function gpuArithmeticAudit() {
  return Object.freeze({
    kernel: GPU_TRANSLATION_KERNEL_VERSION,
    provenSubset: Object.freeze([
      'normalized Q16.16 local coordinates plus bounded canonical step deltas',
      'signed quotient/remainder correction for negative chunk crossings',
      'signed 32-bit chunk-overflow detection without relying on wraparound',
      'one invocation per agent with no reductions, atomics, or ordering dependencies'
    ]),
    blockers: Object.freeze([
      'canonical q16Multiply uses signed products wider than 32 bits and half-away-from-zero rounding',
      'canonical q16ScaleByRatio uses wider-than-32-bit products before division',
      'canonical coordinate helpers use BigInt to make overflow and normalization semantics explicit',
      'spawn/PRNG/deposition sequencing is serially ordered and not covered by this prototype',
      'WebGPU availability and adapter/driver behavior are feature-detected rather than assumed'
    ])
  });
}

export const GPU_RESEARCH_INT_LIMITS = Object.freeze({
  int32Min: INT32_MIN,
  int32Max: INT32_MAX,
  chunkSpanQ16: CHUNK_SPAN_Q16,
  maxStepDisplacementQ16: MAX_STEP_DISPLACEMENT_Q16
});
