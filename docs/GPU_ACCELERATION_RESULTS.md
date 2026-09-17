# FW-015 accepted CI evidence

This file records the first accepted pull-request evidence for the FW-015 GPU equivalence research gate. It is intentionally narrow: GitHub-hosted Linux runners are useful for reproducibility and API behavior, but are not a substitute for representative discrete-GPU validation.

## Run

- Pull request: #33
- Workflow: CI run `35169815344` / run number `354`
- Head: `d6f23d445626c4c8ebd8f62ea172252fa341885c`
- Node 22 verification: passed, including the existing 64k preview profile and 30k-agent release profile
- Node 24 verification: passed
- Chrome browser acceptance: passed
- Firefox browser acceptance: passed

The browser lanes include the entire pre-existing WebGL2/editor/timeline/mutation/export/Infinite Plate/release suite before the FW-015 step, so the research harness did not replace or weaken an existing gate.

## Chrome WebGPU evidence

Environment reported by the runner:

- Chrome / ChromeDriver: `152.0.7977.82`
- platform: Linux
- `navigator.gpu`: present
- WebGPU adapter: available
- adapter vendor: `google`
- architecture: `swiftshader`
- maximum storage-buffer binding size: `134217728` bytes
- maximum compute workgroups per dimension: `65535`

`fw-gpu-translate-v1` passed every one of the 12 full-state/deposition shadow checkpoints. Final identities were:

- state: `b78c9f7e48574024`
- depositions: `9fa31e91b18d529e`
- complete result: `296d6ae9acdf8f38`

The accelerator gate then deliberately retained `backend: cpu`, with the candidate recorded as available and conformant only for the researched translation subset.

### End-to-end translation timing

The candidate measurement includes buffer creation, host upload, command encoding/submission, compute execution, readback mapping and synchronization. Five measured samples followed one warm-up sample.

| Records | CPU min / median / max | WebGPU min / median / max | Interpretation |
|---:|---:|---:|---|
| 1,024 | 0.2 / 0.4 / 0.4 ms | 2.4 / 2.5 / 2.6 ms | CPU clearly preferable; fixed GPU round-trip cost dominates. |
| 8,192 | 1.5 / 1.5 / 1.6 ms | 2.5 / 2.8 / 2.9 ms | CPU remains faster end-to-end. |
| 30,000 | 5.4 / 5.6 / 9.4 ms | 3.0 / 3.1 / 3.6 ms | SwiftShader prototype is faster for this isolated translation batch, but this does not establish a useful canonical simulation accelerator. |

The 30k result is interesting but insufficient for integration. The prototype accelerates only coordinate translation after the CPU has already performed field evaluation, fixed-point material arithmetic, PRNG/spawn/allocation work and ordering-sensitive deposition logic. A real integration that round-tripped agent state per tick would also need to pay architectural transfer/synchronization costs beyond this isolated subset, while the most difficult deterministic arithmetic remains on the CPU.

## Firefox evidence

Environment reported by the runner:

- Firefox: `155.0`
- platform: Linux
- `navigator.gpu`: present
- `requestAdapter()`: returned `null`

The harness therefore recorded WebGPU as unavailable and exercised the required clean CPU fallback. This is an API/capability observation for that runner, not a claim that Firefox 155 generally lacks WebGPU.

## Hardware-coverage limit

The only available WebGPU execution in this accepted run was Chrome's Google SwiftShader software adapter. No physical NVIDIA, AMD or Intel adapter was exercised. Consequently FW-015 establishes:

- a repeatable exact-equivalence method;
- a conformant WGSL translation prototype in one software WebGPU environment;
- clean fallback in a second browser environment where no adapter was returned; and
- honest end-to-end timing for that software adapter.

It does **not** establish cross-vendor physical-GPU equivalence, physical-GPU performance, or enough semantic coverage to promote GPU simulation into the canonical engine. Those limitations are why the accepted decision remains CPU-only, as specified in `GPU_ACCELERATION.md`.
