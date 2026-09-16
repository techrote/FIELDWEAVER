# FIELDWEAVER

FIELDWEAVER is a local-first deterministic generative-art laboratory for **painting behaviours rather than pixels**.

Artists paint invisible scalar/vector fields, release material-like agents into them, intervene while the simulation runs, then preserve, mutate, compare, and export the resulting work. The canonical simulation is deterministic: a recipe, seed, timeline and engine/schema version reproduce the same canonical state.

## Core workflow

**Paint field → release material → run → intervene → freeze/layer → mutate → export**

Initial field families: uniform/gravity, attractor/repulsor, vortex/curl, deterministic turbulence/noise, and direction quantization.

Initial material families: ink, filament, dust, and shard.

LUTs are not merely palettes: their channels may drive colour, lifetime, turn rate, deposition, glyph/material selection, or other deterministic parameters.

## Architectural stance

- Local-first and offline-capable; no cloud/service dependency.
- Dependency-light vanilla browser application, initially using WebGL2 for live rendering.
- Canonical simulation uses fixed-step integer/fixed-point logic and an engine-owned seeded PRNG.
- GPU floating-point simulation is **not** allowed to define canonical deterministic results unless an equivalence proof exists.
- Simulation, editor state, rendering and export are separate subsystems.
- Recipe files are versioned, inspectable, portable and provenance-preserving.
- A later canonical software export path will make decoded output pixels reproducible independently of GPU rasterization.

## Planning and autonomous implementation

The authoritative implementation context is [`RAG.md`](./RAG.md). Repository-agent rules are in [`AGENTS.md`](./AGENTS.md).

GitHub issues are prefixed `FW-###` and are intended to be independently executable after their declared prerequisites have merged. Each issue contains an autonomous implementation prompt, required reading, prerequisites, acceptance criteria, and instructions to implement, test, PR, repair CI, merge after checks pass, verify `main`, and close.

### Roadmap issues

| ID | Issue | Purpose |
|---|---|---|
| FW-001 | #1 | Repository/runtime foundation and quality gates |
| FW-002 | #2 | Canonical deterministic simulation kernel |
| FW-003 | #3 | Chunked field storage and deterministic authoring |
| FW-004 | #4 | Initial deterministic field operator library |
| FW-005 | #5 | Agents, materials, emitters, and deposition events |
| FW-006 | #6 | WebGL2 live renderer and preview |
| FW-007 | #7 | Instrument editor UI and direct manipulation |
| FW-008 | #8 | LUT-as-logic subsystem |
| FW-009 | #9 | Versioned recipes and deterministic command model |
| FW-010 | #10 | Timeline replay, checkpoints, and scrubbing |
| FW-011 | #11 | Mutation lineage and variant comparison |
| FW-012 | #12 | Canonical software raster export and provenance |
| FW-013 | #13 | Infinite Plate deterministic chunk streaming |
| FW-014 | #14 | Presets, diagnostics, hardening, accessibility, release readiness |
| FW-015 | #15 | GPU acceleration equivalence research gate |

Start with **FW-001 / #1**. The full dependency graph and the reviewed/improved architecture are in `RAG.md`.