# FIELDWEAVER

FIELDWEAVER is a local-first deterministic generative-art laboratory for **painting behaviours rather than pixels**.

Artists paint invisible scalar/vector fields, release material-like agents into them, intervene while the simulation runs, then preserve, mutate, compare, and export the resulting work. The canonical simulation is deterministic: a recipe, seed, timeline and engine/schema version reproduce the same canonical state.

## Current implementation status

**FW-001 through FW-005 are implemented.** The browser shell, dependency-free local server, launch helpers, checks and CI remain intact. The DOM-free canonical core provides signed Q16.16 arithmetic, chunk-aware coordinates, xoshiro128** PRNG/substreams, fixed-step scheduling, stable state serialization and golden hashes. Sparse chunk-addressed scalar/vector field storage, deterministic authoring/undo primitives, and the `fw-operators-v1` deterministic field operator stack are available.

The `fw-agents-v1` simulation now adds fixed-capacity typed-array agents with deterministic lowest-free-ID reuse, independently seeded scheduled emitters, four behaviourally distinct baseline materials (Ink, Filament, Dust and Shard), bounded field-driven movement, canonical chunk crossing/lifetime/capacity semantics, and renderer-independent deposition records. WebGL rendering remains explicitly **not yet implemented**; the application does not fake it.

## Quick start

Prerequisite: Node.js 22 or 24.

Windows:

```text
0Play.cmd
```

POSIX:

```text
sh ./0Play.sh
```

Or use npm scripts directly:

```text
npm ci
npm run verify
npm run serve
```

Then open `http://127.0.0.1:4173/` if you used `npm run serve`. `npm start`, `0Play.cmd`, and `0Play.sh` also attempt to open the browser automatically.

No package CDN, cloud service, telemetry endpoint, or other external network dependency is required. The local HTTP server exists so native browser modules run under normal browser security instead of relying on `file://` behaviour.

## Engineering commands

| Command | Purpose |
|---|---|
| `npm run check` | Syntax checks plus version/module/CSP/local-resource policy checks |
| `npm test` | Node built-in tests, including deterministic canonical/field/operator/simulation golden fixtures |
| `npm run verify` | Full local correctness gate (`check` then `test`) |
| `npm run benchmark:sim` | Headless simulation timing/throughput diagnostics; timing is not a correctness gate |
| `npm run serve` | Start the local server on `127.0.0.1:4173` |
| `npm start` | Start the server and attempt to open a browser |

See [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) for browser smoke checks and developer details. Compatibility-sensitive integer, coordinate, PRNG, tick, ordering and hash rules are frozen in [`docs/CANONICAL.md`](./docs/CANONICAL.md). Sparse field storage/authoring is documented in [`docs/FIELDS.md`](./docs/FIELDS.md), operator parameter/support/composition rules are in [`docs/OPERATORS.md`](./docs/OPERATORS.md), and the canonical agent/material/emitter/deposition contract is in [`docs/SIMULATION.md`](./docs/SIMULATION.md).

## Core workflow and roadmap

**Paint field → release material → run → intervene → freeze/layer → mutate → export**

Initial field families: uniform/gravity, attractor/repulsor, vortex/curl, deterministic turbulence/noise, and direction quantization.

Initial material families: ink, filament, dust, and shard.

LUTs are not merely palettes: their channels may drive colour, lifetime, turn rate, deposition, glyph/material selection, or other deterministic parameters.

The authoritative implementation context is [`RAG.md`](./RAG.md). Repository-agent rules are in [`AGENTS.md`](./AGENTS.md).

GitHub issues are prefixed `FW-###` and are independently executable after their declared prerequisites have merged. FW-001 establishes runtime/quality gates; FW-002 canonical state semantics; FW-003 sparse field authoring; FW-004 deterministic field evaluation; FW-005 agents/materials/emitters/deposition. Subsequent work follows the dependency graph in `RAG.md`.

## Architectural stance

- Local-first and offline-capable; no cloud/service dependency.
- Dependency-light vanilla browser application, initially using WebGL2 for live rendering.
- Canonical simulation uses fixed-step integer/fixed-point logic and engine-owned seeded PRNG streams.
- GPU floating-point simulation is **not** allowed to define canonical deterministic results unless an equivalence proof exists.
- Simulation, editor state, rendering and export are separate subsystems.
- Recipe files are versioned, inspectable, portable and provenance-preserving.
- A later canonical software export path will make decoded output pixels reproducible independently of GPU rasterization.
