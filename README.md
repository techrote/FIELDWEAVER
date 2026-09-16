# FIELDWEAVER

FIELDWEAVER is a local-first deterministic generative-art instrument for **painting behaviours rather than pixels**.

Artists paint vector fields, place material emitters into them, run an integer fixed-step simulation, then preserve, mutate, compare, and export the resulting work. Canonical state is deterministic: the same authored definitions, concrete seed, and tick sequence reproduce the same simulation/deposition result.

## Current implementation status

**FW-001 through FW-009 are implemented on this branch, with the FW-016 live-preview interaction regression fix retained.** The dependency-free local server, launch helpers, tests and CI remain intact. The DOM-free canonical substrate provides signed Q16.16 arithmetic, chunk-aware coordinates, xoshiro128** PRNG/substreams, stable serialization/hashes, sparse field authoring, five deterministic field operators, independently seeded emitters, four behaviourally distinct materials, bounded movement, renderer-independent deposition records, deterministic LUT sampling, and versioned recipe replay.

FW-007 provides the first usable instrument editor: ordered/enabled field layers; direct paint/erase; field-origin editing; bounded authoring undo/redo; emitter placement/movement/material assignment; baseline material editing; concrete seed controls; run/pause/exact single-step/configurable multi-step/reset; speed as scheduling only; visible scheduler backlog; keyboard shortcuts; and a separate view-only editor overlay.

FW-008 adds `fw-lut-v1` assets and `fw-lut-map-v1` mappings. LUT channels may drive preview colour or canonical lifetime, steering, deposition strength, and width/radius using explicit integer indexing, clamp/wrap addressing, scale/bias and bounds. The editor includes built-in 256/512 LUTs, channel/entry inspection and editing, deterministic generation, material mapping assignment/removal, and normalized JSON import/export.

FW-009 adds `fw-recipe-v1` persistence plus `fw-command-v1` deterministic intervention timelines. Complete recipes include seed, framing, ordered sparse fields, materials, emitters, LUT assets/mappings, commands and optional lineage. Same-tick commands execute by numeric command ID; malformed or incompatible imports are rejected transactionally. The browser now exposes local **Save recipe** / **Load recipe** controls.

FW-006/FW-016 provide the `fw-webgl2-preview-v1` live view: read-only WebGL2 rendering of canonical deposition records, LUT-resolved deposition colour, DPR-aware resize, pan/zoom, bounded reset/rebuild-safe accumulation, cached stable geometry/GPU buffers, actionable failure handling, and renderer diagnostics.

The WebGL preview is deliberately **noncanonical**. GPU floating point, framebuffer contents, renderer timing, camera state, geometry caches, editor overlay and preview truncation never feed back into simulation state or hashes. Canonical image export remains a later software-raster path.

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

## First creative workflow

1. Choose a field in **Field stack** or add one of the five field operators.
2. Select **Paint [B]** and drag on the canvas. Brush X/Y define the vector painted into deterministic sparse cells.
3. Use **Place emitter [N]** to add an emitter, then assign Ink, Filament, Dust or Shard.
4. In **LUT logic**, inspect/edit a built-in LUT or generate a 256/512-entry asset, then assign its colour or behaviour channel to the selected material.
5. Press **Space** to run, `.` to step exactly one tick, or `Shift+.` for the configured multi-step count.
6. Pause and use authoring undo/redo, reorder/enable fields, move field/emitter origins, edit material/LUT controls, or change the recorded seed. Simulation-affecting authoring edits deterministically reset the live simulation to tick 0.
7. Use **Save recipe** to download the complete normalized project or **Load recipe** to validate and restore a saved recipe without partial mutation on failure.
8. Pan/zoom at any time without changing recipe identity or canonical simulation results.

See [`docs/EDITOR.md`](./docs/EDITOR.md) for the editor/shortcut/determinism contract, [`docs/LUTS.md`](./docs/LUTS.md) for exact LUT sampling semantics, and [`docs/RECIPES.md`](./docs/RECIPES.md) for recipe, command, replay and compatibility contracts.

## Engineering commands

| Command | Purpose |
|---|---|
| `npm run check` | Syntax checks plus version/module/CSP/local-resource policy checks |
| `npm test` | Node built-in deterministic core/field/operator/simulation/editor/LUT/recipe/renderer tests |
| `npm run verify` | Full local correctness gate (`check` then `test`) |
| `npm run benchmark:sim` | Headless canonical simulation timing/throughput diagnostics; timing is not a correctness gate |
| `npm run benchmark:render` | ~64k-deposition interaction profile proving one geometry build followed by cached view transforms |
| `npm run serve` | Start the local server on `127.0.0.1:4173` |
| `npm start` | Start the server and attempt to open a browser |

Developer/browser details are in [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md). Compatibility-sensitive integer, coordinate, PRNG, tick, ordering and hash rules are in [`docs/CANONICAL.md`](./docs/CANONICAL.md). Field storage/authoring is in [`docs/FIELDS.md`](./docs/FIELDS.md), operator semantics in [`docs/OPERATORS.md`](./docs/OPERATORS.md), agent/material/emitter/deposition rules in [`docs/SIMULATION.md`](./docs/SIMULATION.md), LUT semantics in [`docs/LUTS.md`](./docs/LUTS.md), recipe/replay semantics in [`docs/RECIPES.md`](./docs/RECIPES.md), and preview/cache boundaries in [`docs/RENDERER.md`](./docs/RENDERER.md).

## Core workflow and roadmap

**Paint field → release material → run → intervene → freeze/layer → mutate → export**

Initial field families: uniform/gravity, attractor/repulsor, vortex/curl, deterministic turbulence/noise, and direction quantization.

Initial material families: ink, filament, dust, and shard.

LUTs are first-class deterministic assets: their channels can drive colour and validated canonical behaviour parameters without hidden renderer state or PRNG coupling.

The authoritative implementation context is [`RAG.md`](./RAG.md). Repository-agent rules are in [`AGENTS.md`](./AGENTS.md). GitHub issues are prefixed `FW-###` and are independently executable after their declared prerequisites merge.

## Architectural stance

- Local-first and offline-capable; no cloud/service dependency.
- Dependency-light vanilla browser application using WebGL2 only for live rendering.
- Canonical simulation uses fixed-step integer/fixed-point logic and engine-owned seeded PRNG streams.
- LUT sampling for behaviour uses validated integer data and explicit deterministic mapping rules.
- GPU floating-point simulation is **not** allowed to define canonical deterministic results unless an equivalence proof exists.
- DOM/widget state is an editor adapter, never canonical truth.
- Simulation, editor authoring, rendering and export are separate subsystems.
- Recipe files are versioned, inspectable, portable, provenance-preserving and replayable.
- A later canonical software export path will make decoded output pixels reproducible independently of GPU rasterization.
