# FW-015 GPU acceleration equivalence research

## Decision

FW-015 does **not** enable a GPU implementation as canonical FIELDWEAVER simulation. The canonical backend remains the existing JavaScript CPU reference and canonical software export remains entirely independent of GPU rendering or compute.

The research found a narrow integer workload that is suitable for exact cross-checking: chunk-aware Q16.16 position translation using already-computed bounded per-tick velocity deltas. `fw-gpu-translate-v1` implements that operation as a WebGPU compute prototype and `fw-gpu-research-v1` supplies the CPU-vs-candidate conformance and benchmark harness. This is evidence infrastructure, not a new simulation truth source.

The negative integration decision is deliberate. A translation-only offload is too narrow to justify changing the canonical execution architecture, while the materially expensive canonical field/material arithmetic uses wider-than-32-bit intermediates and exact rounding/saturation semantics that cannot be mapped naïvely onto portable WGSL `i32`/`u32` operations. No speed claim is accepted without accounting for host upload, command submission, synchronization and readback.

## Canonical boundary

`CANONICAL_GPU_ACCELERATION_ENABLED` is `false`. `evaluateCanonicalGpuAcceleration()` always selects the CPU backend in FW-015:

- no WebGPU API/adapter: CPU;
- WebGPU initialization or self-test failure: CPU;
- a candidate that diverges at any checkpoint: CPU;
- a candidate that proves the translation subset exactly equivalent: still CPU, because the proof does not cover the complete canonical simulation.

This means recipe meaning, state hashes, deposition hashes, spawn/PRNG order, deposition sequence and FW-012 raw-RGBA export identity are unchanged by whether WebGPU is present.

## Prototype scope

The candidate kernel consumes one independent six-`i32` record per active agent:

`chunkX, chunkY, localX, localY, deltaXQ16, deltaYQ16`

and returns:

`chunkX, chunkY, localX, localY, status`

The input local coordinates are already normalized and each delta is bounded by `MAX_STEP_DISPLACEMENT_Q16`. The GPU kernel reproduces canonical quotient/remainder correction for negative crossings and reports signed 32-bit chunk overflow explicitly instead of depending on wraparound.

It intentionally does **not** implement field sampling, material velocity calculation, emitter spawning, seeded PRNG advancement, agent allocation/reuse, LUT sampling, aging/release, deposition creation or sequence ordering.

## Equivalence method

`runTranslationShadowConformance()` creates one deterministic canonical simulation and advances the authoritative CPU implementation normally. At every tick it sends each active agent's pre-step deposition position plus the CPU-computed canonical velocity to the candidate translation implementation.

The candidate results are then substituted only for:

1. each active agent's resulting canonical position; and
2. each new deposition record's `to` position.

FIELDWEAVER serializes and hashes the complete reconstructed canonical state and cumulative deposition stream. Those hashes must equal the ordinary CPU `stateHash()` and `depositionHash()` at **every checkpoint**, not merely at the final tick. Any differing scalar therefore causes the research candidate to fail conformance.

The Node test suite runs the same harness against the CPU candidate as a harness oracle and deliberately corrupts one candidate coordinate to prove divergence is detected.

## Arithmetic and ordering audit

| Concern | FW-015 finding |
|---|---|
| Signed/unsigned width | Prototype stores signed positions/deltas as `i32`; record counts and invocation IDs are `u32`. Full canonical arithmetic is not approved because several operations require values wider than 32 bits before reduction. |
| Overflow | Translation checks chunk addition bounds before adding. Canonical material arithmetic still relies on explicit BigInt saturation helpers and is outside the candidate. |
| Division/remainder | Translation divides only a normalized local-plus-bounded-delta value by positive `CHUNK_SPAN_Q16`; negative WGSL remainder is explicitly corrected to the canonical nonnegative local coordinate. |
| Rounding | Translation has no fractional division. Canonical `q16Multiply` and `q16ScaleByRatio` use wider products plus exact half-away-from-zero or ratio rounding and are not replaced. |
| Shifts | The prototype performs no shift whose language-specific signed behavior could differ. |
| Workgroup ordering | Each invocation owns one output record. There is no shared workgroup memory or cross-invocation dependency. |
| Atomics/reductions | None. The prototype does not attempt spawn counts, allocation, deposition sequencing or any other order-sensitive reduction. |
| Driver/API behavior | WebGPU is feature-detected. Adapter absence, shader/pipeline failure or failed self-test is a clean CPU fallback, never a semantic downgrade. |

The important blocker is not merely API availability. Canonical functions such as `q16Multiply` and `q16ScaleByRatio` deliberately use BigInt intermediates so a signed 32-bit result is obtained after exact wider multiplication, division, rounding and saturation. A straightforward WGSL `i32` implementation would overflow before those canonical rules can be applied. Implementing and proving a portable multiword arithmetic layer may be possible, but FW-015 found no justification for adding that complexity merely to offload the small translation subset.

## Benchmark methodology

`benchmarkTranslationCandidate()` uses deterministic record sets at 1,024, 8,192 and 30,000 records by default. For every size it:

1. generates one fixed workload containing ordinary and chunk-crossing positions;
2. computes the canonical CPU output;
3. performs warm-up iterations;
4. measures repeated CPU and candidate iterations;
5. byte-compares every candidate `Int32Array` scalar to the CPU output; and
6. reports minimum, median and maximum elapsed time rather than a single best sample.

Candidate timing is deliberately end-to-end: buffer creation, host upload, command encoding/submission, GPU execution, readback mapping and synchronization are inside the timed operation. This makes the result relevant to the current per-tick architecture rather than reporting kernel-only throughput that the application cannot realize.

Timing is evidence, not a correctness oracle. Exact output equality is mandatory before a timing sample is accepted.

## Browser and hardware evidence

CI executes the FW-015 browser harness in the same Chrome and Firefox Linux lanes already used for FIELDWEAVER browser acceptance. The log records browser version, platform, whether `navigator.gpu` exists, adapter information where exposed, full conformance checkpoints and benchmark ranges when a WebGPU adapter is actually available. If a runner/browser exposes no usable WebGPU adapter, the log records that fact rather than manufacturing a result.

The GitHub-hosted CI environment is **not** evidence for discrete desktop GPU performance or cross-vendor support. It is useful for API/capability behavior and, where the runner exposes WebGPU, exact candidate equivalence. FIELDWEAVER therefore makes no NVIDIA/AMD/Intel hardware acceleration claim from FW-015. Broad physical-GPU validation would be required before any future canonical accelerator support claim.

The exact evidence from the accepted PR run is recorded in its `fw-browser-chrome-smoke` and `fw-browser-firefox-smoke` artifacts. The merged architectural decision does not depend on WebGPU being available in those ephemeral CI runners.

## Future promotion gate

A later GPU simulation effort should not start by weakening this decision. Promotion to a canonical accelerator requires all of the following:

- exact implementation of the wider fixed-point arithmetic contract, including overflow, saturation and rounding;
- preservation of stable spawn, PRNG, allocation, agent and deposition ordering;
- adversarial CPU-vs-GPU state and deposition hash equivalence over the complete accelerated operation set;
- conformance on every browser/GPU environment that is claimed as supported, with automatic fallback for any environment that fails;
- an architecture that amortizes transfer/synchronization costs rather than round-tripping canonical state per small operation; and
- representative workload evidence showing a material end-to-end benefit, not merely a faster isolated shader.

Until those conditions are met, the CPU reference is both the implementation and the authority.
