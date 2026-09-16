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

GitHub issues are prefixed `FW-###` and are intended to be independently executable after their declared prerequisites have merged. Each issue contains an autonomous implementation prompt and acceptance criteria.

The current roadmap is planning-first: the repository starts with contracts and issue decomposition before product implementation.