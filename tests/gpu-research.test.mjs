import test from 'node:test';
import assert from 'node:assert/strict';

import { CHUNK_SPAN_Q16, INT32_MAX, Q16_ONE } from '../src/core/index.js';
import {
  CANONICAL_GPU_ACCELERATION_ENABLED,
  CpuTranslationCandidate,
  benchmarkTranslationCandidate,
  evaluateCanonicalGpuAcceleration,
  gpuArithmeticAudit,
  packTranslationRecords,
  runTranslationShadowConformance,
  translatePackedCpu,
  unpackTranslationOutput
} from '../src/sim/gpu-research.js';

test('packed CPU translation preserves canonical chunk normalization and overflow signalling', () => {
  const input = packTranslationRecords([
    {
      chunkX: 0,
      chunkY: 0,
      localX: 0,
      localY: 0,
      deltaXQ16: -Q16_ONE,
      deltaYQ16: Q16_ONE
    },
    {
      chunkX: INT32_MAX,
      chunkY: 0,
      localX: CHUNK_SPAN_Q16 - 1,
      localY: 0,
      deltaXQ16: Q16_ONE,
      deltaYQ16: 0
    }
  ]);
  const records = unpackTranslationOutput(translatePackedCpu(input));
  assert.deepEqual(records[0], {
    chunkX: -1,
    chunkY: 0,
    localX: CHUNK_SPAN_Q16 - Q16_ONE,
    localY: Q16_ONE,
    status: 0
  });
  assert.equal(records[1].chunkX, INT32_MAX);
  assert.equal(records[1].status, 1);
});

test('shadow conformance compares complete state and deposition hashes at every checkpoint', async () => {
  const first = await runTranslationShadowConformance(new CpuTranslationCandidate());
  const second = await runTranslationShadowConformance(new CpuTranslationCandidate());
  assert.equal(first.passed, true);
  assert.equal(first.checkpoints.length, 12);
  assert.ok(first.checkpoints.every((entry) => entry.stateEquivalent && entry.depositionEquivalent));
  assert.equal(first.finalStateHash, second.finalStateHash);
  assert.equal(first.finalDepositionHash, second.finalDepositionHash);
  assert.equal(first.finalResultHash, second.finalResultHash);
});

class CorruptTranslationCandidate extends CpuTranslationCandidate {
  constructor() {
    super();
    this.kind = 'deliberately-corrupt-test-candidate';
  }

  async translate(input) {
    const output = translatePackedCpu(input);
    if (output.length > 0) output[2] = (output[2] + 1) % CHUNK_SPAN_Q16;
    return output;
  }
}

test('shadow conformance rejects a candidate that changes one canonical coordinate', async () => {
  const report = await runTranslationShadowConformance(new CorruptTranslationCandidate());
  assert.equal(report.passed, false);
  assert.ok(report.failure);
  assert.equal(report.failure.stateEquivalent, false);
});

test('canonical accelerator gate cleanly falls back to CPU for unavailable and divergent candidates', async () => {
  const unavailable = await evaluateCanonicalGpuAcceleration({
    candidate: { available: false, reason: 'test adapter unavailable' }
  });
  assert.deepEqual({
    backend: unavailable.backend,
    canonical: unavailable.canonical,
    candidateAvailable: unavailable.candidateAvailable,
    candidateConformant: unavailable.candidateConformant
  }, {
    backend: 'cpu',
    canonical: true,
    candidateAvailable: false,
    candidateConformant: false
  });

  const divergent = await evaluateCanonicalGpuAcceleration({ candidate: new CorruptTranslationCandidate() });
  assert.equal(divergent.backend, 'cpu');
  assert.equal(divergent.canonical, true);
  assert.equal(divergent.candidateAvailable, true);
  assert.equal(divergent.candidateConformant, false);
});

test('even a conformant translation subset does not redefine the canonical CPU backend', async () => {
  const result = await evaluateCanonicalGpuAcceleration({ candidate: new CpuTranslationCandidate() });
  assert.equal(CANONICAL_GPU_ACCELERATION_ENABLED, false);
  assert.equal(result.backend, 'cpu');
  assert.equal(result.canonical, true);
  assert.equal(result.candidateAvailable, true);
  assert.equal(result.candidateConformant, true);
  assert.match(result.reason, /does not enable canonical GPU execution/i);
});

test('GPU arithmetic audit records the wider-intermediate and serial-ordering blockers', () => {
  const audit = gpuArithmeticAudit();
  assert.ok(audit.provenSubset.some((entry) => entry.includes('no reductions')));
  assert.ok(audit.blockers.some((entry) => entry.includes('wider than 32 bits')));
  assert.ok(audit.blockers.some((entry) => entry.includes('spawn/PRNG/deposition sequencing')));
});

test('benchmark harness reports repeat ranges and verifies exact candidate output', async () => {
  const report = await benchmarkTranslationCandidate(new CpuTranslationCandidate(), {
    sizes: [32, 128],
    repeats: 3,
    warmups: 0
  });
  assert.equal(report.results.length, 2);
  for (const result of report.results) {
    assert.ok(result.cpu.minMs >= 0);
    assert.ok(result.cpu.medianMs >= result.cpu.minMs);
    assert.ok(result.cpu.maxMs >= result.cpu.medianMs);
    assert.ok(result.candidate.minMs >= 0);
    assert.ok(result.candidate.medianMs >= result.candidate.minMs);
    assert.ok(result.candidate.maxMs >= result.candidate.medianMs);
  }
  assert.match(report.timingBoundary, /upload.*readback.*synchronization/i);
});
