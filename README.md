# FIELDWEAVER

FIELDWEAVER is a local-first deterministic generative-art instrument for **painting behaviours rather than pixels**.

Artists paint vector fields, place material emitters into them, run an integer fixed-step simulation, then preserve, intervene, replay, mutate, compare, explore an effectively unbounded plate, and export the resulting work. Canonical state is deterministic: the same authored definitions, concrete seed, command timeline, and target tick reproduce the same simulation/deposition result.

## Current implementation status

**FW-001 through FW-015 are implemented on this branch, with the FW-016 live-preview interaction regression fix retained.** The dependency-free local server, launch helpers, tests and CI remain intact. The DOM-free canonical substrate provides signed Q16.16 arithmetic, chunk-aware coordinates, xoshiro128** PRNG/substreams, stable serialization/hashes, sparse field authoring, five deterministic field operators, independently seeded emitters, four behaviourally distinct materials, bounded movement, renderer-independent deposition records, deterministic LUT sampling, versioned recipes, explicit commands, deterministic timeline replay, recipe-level mutation lineage, deterministic software-raster export, and deterministic regional Infinite Plate evaluation.

FW-007 provides the first usable instrument editor: ordered/enabled field layers; direct paint/erase; field-origin editing; bounded authoring undo/redo; emitter placement/movement/material assignment; baseline material editing; concrete seed controls; run/pause/exact single-step/configurable multi-step/reset; speed as scheduling only; visible scheduler backlog; keyboard shortcuts; and a separate view-only editor overlay.

FW-008 adds `fw-lut-v1` assets and `fw-lut-map-v1` mappings. LUT channels may drive preview colour or canonical lifetime, steering, deposition strength, and width/radius using explicit integer indexing, clamp/wrap addressing, scale/bias and bounds. The editor includes built-in 256/512 LUTs, channel/entry inspection and editing, deterministic generation, material mapping assignment/removal, and normalized JSON import/export.

FW-009 adds `fw-recipe-v1` persistence plus `fw-command-v1` deterministic intervention timelines. Complete recipes include seed, framing, ordered sparse fields, materials, emitters, LUT assets/mappings, commands and optional lineage. Same-tick commands execute by numeric command ID; malformed or incompatible imports are rejected transactionally. The browser exposes local **Save recipe** / **Load recipe** controls.

FW-010 adds `fw-timeline-v1`: a linear playhead/event editor, deterministic arbitrary-tick replay, bounded transient checkpoints, conservative cache invalidation after timeline edits, separate timeline undo/redo, same-tick ordering controls, and checkpoint/replay diagnostics. Backward seeking never reverses physics; it restores a valid checkpoint (or tick 0) and executes ordinary canonical replay forward. Checkpoint presence, spacing and eviction affect performance only.

FW-011 adds `fw-mutation-v1` deterministic recipe mutation and `fw-lineage-v1` provenance records. Explicit mutation seeds/substreams drive bounded material, field, emitter, layer-order, LUT, and sibling-seed operators. The editor can fork multiple immutable siblings, inspect exact normalized diffs, navigate/restore variants, and render replay-isolated A/B or small-grid comparisons without sharing mutable canonical simulation state.

FW-012 adds `fw-canonical-raster-v1` and `fw-canonical-export-v1`: canonical recipe replay to a selected tick, integer/BigInt point-disc-segment rasterization, sequence-ordered integer compositing, seam-free tiled evaluation, FNV-1a-64 raw RGBA identity, dependency-free RGBA8 PNG packaging, and a provenance sidecar containing recipe/seed/version/tick/crop/state/deposition/result/lineage evidence. The browser exposes independent crop, scale, tick, and tile controls plus separate PNG and provenance downloads.

FW-013 adds `fw-infinite-plate-v1` deterministic regional evaluation. The live camera can travel across stable chunk coordinates without becoming simulation truth. **Frame current view** turns a discovered region into an explicit crop without rebasing authored coordinates, then deterministic foreground replay evaluates/cache-indexes the requested chunks and feeds the existing FW-012 software raster. Cache size, eviction, camera history, request order, raster tile order, and browser/GPU timing are nonsemantic. The panel exposes evaluation progress/cancellation, cache eviction, canonical regional hashes, PNG/provenance download, and documented work/chunk/image safeguards.

FW-014 adds release-readiness hardening: four curated deterministic presets with checked-in recipe/state/deposition/result/raw-RGBA identities; consolidated simulation/replay/cache/export/renderer diagnostics; explicit memory/work bounds; a repeatable 30,000-active-agent canonical simulation profile; Chrome and Firefox acceptance for the complete browser workflow; and accessibility corrections for field controls, the interactive canvas, labels, focus semantics and keyboard authoring. The focused canvas can apply a Paint/Erase stamp at the current view centre with **Enter**. See [`docs/RELEASE_READINESS.md`](./docs/RELEASE_READINESS.md) and [`docs/ACCESSIBILITY.md`](./docs/ACCESSIBILITY.md).

FW-015 adds an evidence-driven GPU equivalence research gate. `fw-gpu-research-v1` compares reconstructed candidate state/deposition hashes against the canonical CPU engine at every checkpoint, while `fw-gpu-translate-v1` prototypes exact WebGPU chunk-aware integer position translation. Chrome CI demonstrated equivalence for that narrow subset on its SwiftShader adapter and Firefox CI recorded a clean unavailable-adapter fallback. The subset is not broad enough to justify canonical GPU integration: wider fixed-point intermediates and serial PRNG/allocation/deposition ordering remain CPU-authoritative, so `CANONICAL_GPU_ACCELERATION_ENABLED` stays `false`. See [`docs/GPU_ACCELERATION.md`](./docs/GPU_ACCELERATION.md) and [`docs/GPU_ACCELERATION_RESULTS.md`](./docs/GPU_ACCELERATION_RESULTS.md).

FW-006/FW-016 provide the `fw-webgl2-preview-v1` live view: read-only WebGL2 rendering of canonical deposition records, LUT-resolved deposition colour, DPR-aware resize, pan/zoom, bounded reset/rebuild-safe accumulation, cached stable geometry/GPU buffers, actionable failure handling, and renderer diagnostics. After a backward timeline seek, a changed/shortened canonical deposition tail automatically causes the preview accumulator to rebuild rather than retain stale artwork.

The WebGL preview is deliberately **noncanonical**. GPU floating point, framebuffer contents, renderer timing, camera state, geometry caches, editor overlay, wall-clock telemetry and preview truncation never feed back into simulation state or hashes. Canonical image identity is the decoded row-major RGBA8 buffer from the FW-012 software rasterizer; PNG file bytes are packaging rather than the pixel oracle.

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

1. In **Built-in presets**, select **First Weave** (or another shipped example) and choose **Load preset** for an immediate deterministic starting point. Preset selection itself does not mutate the work; loading adopts the validated recipe.
2. Choose a field in **Field stack** or add one of the five field operators.
3. Select **Paint [B]** and drag on the canvas. For keyboard-only authoring, focus the canvas and press **Enter** to apply one Paint/Erase brush stamp at the current view centre.
4. Use **Place emitter [N]** to add an emitter, then assign Ink, Filament, Dust or Shard. The sidebar also exposes a keyboard-reachable add-at-view-centre path.
5. In **LUT logic**, inspect/edit a built-in LUT or generate a 256/512-entry asset, then assign its colour or behaviour channel to the selected material.
6. Press **Space** to run, `.` to step exactly one tick, or `Shift+.` for the configured multi-step count.
7. In **Timeline**, add/edit deterministic intervention events, seek to arbitrary ticks, or move backward knowing FIELDWEAVER is restoring/replaying rather than numerically reversing the simulation. Timeline undo/redo changes event authoring only.
8. Pause and use field authoring undo/redo, reorder/enable fields, move field/emitter origins, edit material/LUT controls, or change the recorded seed. Non-command recipe edits establish a new initial state and reset timeline checkpoint memoization.
9. Use **Save recipe** to download the complete normalized project or **Load recipe** to validate and restore a saved recipe without partial mutation on failure.
10. In **Mutation & variants**, choose an explicit mutation seed/scope/intensity, fork siblings, inspect exact diffs, restore a variant, or compare up to four independently replayed variants at one tick.
11. Pan/zoom to explore stable world chunks. In **Infinite Plate**, choose **Frame current view** to copy the camera into an explicit crop, set the target tick/cache bound, and **Evaluate selected crop**. You can cancel foreground evaluation or evict the memo cache without changing canonical results.
12. Download the Infinite Plate canonical PNG/provenance directly, or use the synchronized **Canonical export** controls to prepare the same FW-012 software-raster crop and verify its raw RGBA hash. The **Diagnostics** panel distinguishes canonical identities from noncanonical renderer/performance telemetry.

See [`docs/EDITOR.md`](./docs/EDITOR.md) for the editor/shortcut/determinism contract, [`docs/LUTS.md`](./docs/LUTS.md) for exact LUT sampling semantics, [`docs/RECIPES.md`](./docs/RECIPES.md) for recipe/command compatibility, [`docs/TIMELINE.md`](./docs/TIMELINE.md) for seek/checkpoint/invalidation semantics, [`docs/MUTATION.md`](./docs/MUTATION.md) for deterministic mutation, lineage, rejection, and comparison-isolation semantics, [`docs/EXPORT.md`](./docs/EXPORT.md) for canonical pixel, tiling, PNG, provenance, and failure semantics, [`docs/INFINITE_PLATE.md`](./docs/INFINITE_PLATE.md) for regional causality/cache/framing/cancellation/export semantics, [`docs/RELEASE_READINESS.md`](./docs/RELEASE_READINESS.md) for presets/performance/memory/browser/error-handling evidence, [`docs/ACCESSIBILITY.md`](./docs/ACCESSIBILITY.md) for the keyboard and semantics audit, and [`docs/GPU_ACCELERATION.md`](./docs/GPU_ACCELERATION.md) for the FW-015 equivalence methodology and CPU-only integration decision.

## Engineering commands

| Command | Purpose |
|---|---|
| `npm run check` | Syntax checks plus version/module/CSP/local-resource policy checks |
| `npm test` | Node built-in deterministic core/field/operator/simulation/editor/LUT/recipe/timeline/mutation/export/Infinite Plate/preset/renderer/GPU-research tests |
| `npm run verify` | Full local correctness gate (`check` then `test`) |
| `npm run benchmark:sim` | Headless canonical simulation timing/throughput diagnostics; timing is not a correctness gate |
| `npm run benchmark:render` | ~64k-deposition interaction profile proving one geometry build followed by cached view transforms |
| `npm run benchmark:release` | Repeated 30k-active-agent canonical simulation pressure profile with deterministic hash-equivalence assertions |
| `npm run serve` | Start the local server on `127.0.0.1:4173` |
| `npm start` | Start the server and attempt to open a browser |

Developer/browser details are in [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md). Compatibility-sensitive integer, coordinate, PRNG, tick, ordering and hash rules are in [`docs/CANONICAL.md`](./docs/CANONICAL.md). Field storage/authoring is in [`docs/FIELDS.md`](./docs/FIELDS.md), operator semantics in [`docs/OPERATORS.md`](./docs/OPERATORS.md), agent/material/emitter/deposition rules in [`docs/SIMULATION.md`](./docs/SIMULATION.md), LUT semantics in [`docs/LUTS.md`](./docs/LUTS.md), recipe/command semantics in [`docs/RECIPES.md`](./docs/RECIPES.md), timeline semantics in [`docs/TIMELINE.md`](./docs/TIMELINE.md), mutation/lineage semantics in [`docs/MUTATION.md`](./docs/MUTATION.md), canonical output semantics in [`docs/EXPORT.md`](./docs/EXPORT.md), Infinite Plate semantics in [`docs/INFINITE_PLATE.md`](./docs/INFINITE_PLATE.md), preview/cache boundaries in [`docs/RENDERER.md`](./docs/RENDERER.md), release bounds/support/troubleshooting in [`docs/RELEASE_READINESS.md`](./docs/RELEASE_READINESS.md), and GPU equivalence research in [`docs/GPU_ACCELERATION.md`](./docs/GPU_ACCELERATION.md).

## Core workflow and roadmap

**Load or paint → release material → run → intervene → freeze/layer → mutate → explore → export**

Initial field families: uniform/gravity, attractor/repulsor, vortex/curl, deterministic turbulence/noise, and direction quantization.

Initial material families: ink, filament, dust, and shard.

LUTs are first-class deterministic assets: their channels can drive colour and validated canonical behaviour parameters without hidden renderer state or PRNG coupling.

The authoritative implementation context is [`RAG.md`](./RAG.md). Repository-agent rules are in [`AGENTS.md`](./AGENTS.md). GitHub issues are prefixed `FW-###` and are independently executable after their declared prerequisites merge.

## Architectural stance

- Local-first and offline-capable; no cloud/service dependency.
- Dependency-light vanilla browser application using WebGL2 only for live rendering.
- Canonical simulation uses fixed-step integer/fixed-point logic and engine-owned seeded PRNG streams.
- LUT sampling for behaviour uses validated integer data and explicit deterministic mapping rules.
- GPU compute is research-only in FW-015: a narrow integer translation kernel has equivalence evidence, but the CPU remains the sole canonical simulation backend until the complete accelerated operation set proves the same semantics and is worthwhile end-to-end.
- DOM/widget state is an editor adapter, never canonical truth.
- Simulation, editor authoring, timeline replay, mutation, regional evaluation, rendering and export are separate subsystems.
- Recipe files are versioned, inspectable, portable, provenance-preserving and replayable.
- Mutation operates on detached recipe snapshots; parent and sibling ancestry is immutable from a created child.
- Timeline checkpoints and Infinite Plate chunk caches are bounded transient memoization and are never recipe truth.
- Presets are ordinary validated recipes with checked-in deterministic golden identities, not hidden special cases.
- Canonical image identity is the decoded software-raster RGBA8 byte buffer; WebGL framebuffer contents, wall-clock timing and PNG compression are not canonical state.
