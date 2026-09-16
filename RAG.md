# FIELDWEAVER — RAG implementation context

This document is the authoritative retrieval context for implementation agents. Read it with `AGENTS.md` and the GitHub issue being implemented.

## Contents

1. Product definition and user workflow
2. Goals, non-goals, and product invariants
3. Plan review and corrected architecture
4. Canonical determinism contract
5. Core data model
6. Fields, materials, emitters, and LUT logic
7. Editor, timeline, mutation, and Infinite Plate
8. Rendering and export
9. Performance and compatibility targets
10. Repository shape and engineering conventions
11. Roadmap and dependency graph
12. Autonomous issue execution protocol
13. Completion definition
14. Deferred extensions

---

## 1. Product definition and user workflow

FIELDWEAVER is a local-first generative-art laboratory for **painting behaviours rather than pixels**.

The artist paints invisible scalar/vector fields and masks, releases simulated materials into them, runs a deterministic simulation, intervenes over time, freezes or layers results, mutates recipes, and exports selected compositions.

Primary creative loop:

> Paint field → release material → run → intervene → freeze/layer → mutate → compare → export

The product must feel like an instrument, not a parameter form. Direct canvas interaction, immediate feedback, keyboard control, inspectable state, and deterministic experimentation are core qualities.

The first useful release should already support:

- multiple ordered field layers;
- five field operators;
- four materially distinct agent types;
- deterministic emitters and seeded simulation;
- run/pause, speed control, single-tick stepping, reset, and seed control;
- LUT-driven colour and behaviour modulation;
- save/load of complete recipes;
- deterministic timeline replay;
- mutation/forking of recipes;
- PNG export plus recipe provenance;
- a chunk-aware foundation that can grow into Infinite Plate.

---

## 2. Goals, non-goals, and product invariants

### Goals

- Make algorithmic art through spatially painted behaviour.
- Preserve exact logical reproducibility from explicit recipe inputs.
- Support exploratory intervention without destroying provenance.
- Remain understandable enough that a user can reason about why an image formed.
- Run locally in an ordinary modern browser with no service dependency.
- Keep the architecture dependency-light and hackable.
- Provide a credible path from interactive 1080p work to large deterministic exports.

### Non-goals for the initial roadmap

- AI image generation.
- Cloud accounts, collaboration servers, telemetry, or required remote APIs.
- General-purpose node-graph programming.
- Arbitrary user scripting in the first release.
- Physics realism for its own sake.
- Cross-hardware bit-identical GPU floating-point simulation.
- Infinite undo history for every simulation tick.
- 3D rendering.

### Invariants

- Canonical state never depends on frame rate, wall-clock time, GPU floating-point behaviour, DOM scheduling, browser animation timing, object-property enumeration accidents, or global randomness.
- Rendering consumes simulation state; rendering does not mutate canonical simulation state.
- Every persistent format is versioned and validated.
- User-visible noncanonical modes must identify themselves explicitly.
- New dependencies require justification. Prefer browser APIs and Node standard library for tooling/tests.
- The app is offline-capable after checkout/download and local launch.

---

## 3. Plan review and corrected architecture

The original concept proposed GPU-side simulation where practical. Review identified several architectural risks and corrected them before implementation.

### Review finding A — GPU floating point conflicts with exact determinism

WebGL/WebGPU implementations, shader compilers, floating-point contraction/precision, and driver behaviour can differ. Therefore GPU floating-point simulation cannot define canonical state.

**Correction:** canonical simulation runs in JavaScript using explicit 32-bit integer/fixed-point arithmetic, deterministic lookup tables, and an engine-owned seeded PRNG. WebGL2 initially renders the result. A future GPU simulator is permitted only as either:

1. a noncanonical preview/accelerator clearly marked as such; or
2. a proven-equivalent integer path with conformance tests against the canonical implementation.

### Review finding B — “Infinite Plate later” can force a destructive rewrite

A finite monolithic coordinate model would make later unbounded/chunked space invasive.

**Correction:** define world coordinates and field storage with chunk-awareness from the first simulation/data-model issue. The UI may initially expose a bounded working region, but persistent identities and coordinates must not assume a single finite texture/canvas.

### Review finding C — replay cannot be bolted onto mutable editor state

If live interventions directly mutate state without a command/event model, save/load and timeline replay become ambiguous.

**Correction:** persistent user actions that affect canonical simulation are represented as validated deterministic commands. The initial editor may expose only a simple linear timeline, but the command semantics are established before advanced timeline UI.

### Review finding D — “same artwork” needs two reproducibility tiers

Exact simulation state can be deterministic while WebGL rasterization and PNG compression differ.

**Correction:** define two guarantees:

- **Canonical state determinism:** same engine/schema version + recipe + seed + command timeline produces identical canonical state hashes.
- **Canonical image determinism:** the dedicated software export path produces identical raw RGBA pixels for the same canonical inputs. PNG file bytes need not be identical if encoders differ; raw pixel hashes are the oracle.

The interactive WebGL2 preview is visually faithful but is not the canonical pixel oracle.

### Review finding E — mutation must operate on recipes, not opaque state

Mutation of raw simulation memory would be difficult to reason about or reproduce.

**Correction:** mutations are explicit deterministic transformations of recipe parameters and/or seed lineage. Every child records parent identity plus mutation operations.

### Improved architecture

Four hard subsystem boundaries:

1. **Model/core** — deterministic recipe schema, field definitions, commands, PRNG, fixed-step simulation, snapshots/hashes.
2. **Editor** — tools, selection, field painting, inspectors, history, timeline authoring, mutation controls.
3. **Renderer** — WebGL2 preview, display compositing, overlays, picking support; read-only with respect to canonical model state.
4. **Export** — canonical software raster path, PNG packaging, recipe/provenance sidecar, crop/tile handling.

The model must remain testable headlessly under Node without a DOM or GPU.

---

## 4. Canonical determinism contract

### Fixed-step clock

Simulation advances only by integer ticks. UI speed changes how many canonical ticks are requested per unit wall time; it never changes the tick duration or equations.

Pause stops tick advancement. Single-step advances exactly one tick. Reset restores a deterministic initial state from the current recipe/seed.

### Numeric representation

Canonical simulation avoids ordinary floating-point arithmetic in state transitions.

Recommended baseline:

- chunk coordinates: signed 32-bit integers;
- local position/velocity: signed 32-bit fixed-point integers;
- field samples/strengths: explicit bounded integer/fixed-point formats;
- counters, IDs, and seeds: unsigned/signed 32-bit integers as appropriate;
- multiplication/division helpers specify saturation/rounding behaviour;
- trigonometric or normalized-direction behaviour uses checked-in integer lookup tables or deterministic integer algorithms.

Exact Q-format choices are established in FW-002 and then treated as a compatibility contract.

### PRNG

Use an explicitly specified 32-bit PRNG with stable test vectors (for example xoshiro/xoroshiro-family only if the exact algorithm and seeding scheme are documented and tested). No `Math.random()` in canonical code.

Distinct deterministic streams/substreams should prevent unrelated features from perturbing one another merely because call counts changed. Stream identity should derive from stable IDs and seed material rather than hidden global sequence position where practical.

### Ordering

Any iteration where order affects results must use a defined order: stable numeric IDs, array index order, or an explicitly sorted key. Never rely on unspecified map/object iteration semantics for canonical outcomes.

### Hashes and fixtures

The core exposes stable canonical serialization/hashing suitable for fixtures. Tests should include:

- PRNG test vectors;
- arithmetic edge cases;
- repeated-run state hashes;
- save/load/replay equivalence;
- command-timeline replay equivalence;
- selected end-to-end golden state hashes.

### Versioning

Recipes and canonical state semantics carry schema/engine compatibility versions. A newer runtime must not silently reinterpret an incompatible older recipe. Migrations must be explicit and tested.

---

## 5. Core data model

### Recipe

A recipe describes reproducible creative intent, not transient UI chrome. It includes at minimum:

- schema version;
- canonical engine compatibility version;
- root seed;
- canvas/export framing defaults;
- ordered field-layer definitions;
- material definitions;
- emitter definitions;
- LUT assets/mappings;
- deterministic command/timeline entries;
- mutation lineage metadata where applicable.

### World coordinates

Use chunk-aware coordinates from the beginning. A logical position is conceptually:

`(chunkX, chunkY, localX, localY)`

Local coordinates are normalized when crossing chunk boundaries. Stable world-space identities permit later streaming/culling without changing recipe meaning.

### Field layers

A field layer has:

- stable ID;
- type/operator;
- enabled flag;
- strength and type-specific integer parameters;
- transform/world placement;
- mask/source data;
- blend/composition operation;
- optional LUT/parameter modulation references.

Field painting should use sparse/chunked storage rather than a single mandatory world-sized texture. Initial chunks may use fixed-resolution scalar/vector grids with deterministic brush rasterization.

### Agents/materials

Simulation agents use structure-of-arrays typed storage for predictable performance and iteration order. Each agent has stable identity and the minimum canonical state needed by its material behaviour.

Material definitions describe behaviour families rather than decorative sprite swaps.

### Emitters

Emitters deterministically generate agents from explicit schedules, masks/geometry, material references, rates/bursts, and seed substreams. Spawn ordering is specified.

### Commands

Canonical interventions are validated commands such as:

- change parameter at tick N;
- enable/disable field at tick N;
- alter emitter rate at tick N;
- release a deterministic burst at tick N;
- freeze/resume a layer at tick N;
- change LUT mapping at tick N.

Purely visual editor actions such as panning do not belong in canonical command history.

---

## 6. Fields, materials, emitters, and LUT logic

### Initial field operators

1. **Uniform / gravity vector** — constant directional influence.
2. **Attractor / repulsor** — point or painted-source radial influence with deterministic falloff.
3. **Vortex / curl** — rotational influence around a point/painted source.
4. **Turbulence / noise** — seeded deterministic integer noise sampled in world coordinates.
5. **Direction quantizer** — snaps/steers movement toward a configurable number of angular sectors using deterministic lookup tables.

Field composition order is explicit. Layer blend modes should begin conservatively (add, multiply/scale where meaningful, max/min or replace if justified) and be specified with integer arithmetic.

### Initial materials

- **Ink** — continuous deposition, moderate inertia, density accumulation.
- **Filament** — connected/long-lived trails with stronger directional persistence and bend limits.
- **Dust** — discrete point deposition/cloud behaviour, short or medium lifetime.
- **Shard** — quantized/segment-like travel with abrupt directional changes.

Material differences must be behavioural and testable.

### LUT-as-logic

A LUT is a deterministic sampled data asset, not only a colour palette. A LUT can expose channels to mapped destinations such as:

- colour;
- lifetime multiplier;
- turn/steering strength;
- deposition strength;
- line width or canonical export radius;
- material/glyph family selection later.

Mappings define input source, channel, integer scaling/range, clamp/wrap behaviour, and destination. Sampling/indexing is deterministic.

Baseline LUT sizes should permit common 256/512-entry workflows without requiring one fixed size globally.

---

## 7. Editor, timeline, mutation, and Infinite Plate

### Editor interaction

Required baseline tools:

- field layer create/delete/reorder/enable;
- direct canvas brush painting and erasing of masks/source values;
- select/move/edit field controls;
- emitter placement/editing;
- material selection/editing;
- seed edit/randomize-with-recorded-value;
- run/pause;
- simulation speed control;
- single-tick and configurable multi-tick stepping;
- reset to deterministic initial state;
- zoom/pan without affecting canonical state;
- undo/redo for authoring actions.

Keyboard access is required for core controls.

### Timeline

The first timeline can be linear. It must display deterministic command events against simulation ticks, allow replay from a known checkpoint/start, and make scrubbing semantics explicit.

Scrubbing may restore a prior snapshot then replay commands/ticks; it must not guess state by reversing nonreversible equations.

### Mutation lineage

Mutation creates recipe children. Each mutation records:

- parent recipe identity/hash;
- mutation operation(s);
- derived or explicit child seed;
- resulting recipe identity/hash.

Useful initial mutation operators:

- perturb a numeric parameter by bounded deterministic delta;
- rotate/swap LUT or LUT mapping;
- alter one field strength/scale;
- move an emitter/field control point within bounds;
- swap adjacent field-layer order;
- derive a sibling seed.

Mutation must never produce an invalid recipe silently.

### Infinite Plate

The later Infinite Plate feature presents an effectively unbounded chunked plane. Requirements:

- chunk identity derives only from world coordinates and recipe/seed data;
- simulation activation/culling must not change results inside a requested canonical region;
- field data is sparse and chunk-addressed;
- user can pan far from origin, discover generated structures, and frame a crop as artwork;
- export can request a finite crop without requiring the whole plate in memory;
- chunk cache eviction is nonsemantic.

The early core need not expose endless navigation immediately, but it must not preclude these guarantees.

---

## 8. Rendering and export

### Live renderer

Initial live renderer: WebGL2.

Responsibilities:

- native-resolution canvas with device-pixel-ratio handling;
- efficient drawing of agent trails/deposits and editor overlays;
- compositing field/material layers visually;
- viewport pan/zoom;
- optional diagnostic overlays;
- no mutation of canonical simulation state.

A Canvas2D emergency/fallback renderer is optional, not required unless an issue explicitly adds it.

### Deposition representation

Live preview may use GPU render targets or other efficient buffers, but canonical export must not depend on them as the only source of truth. The simulation/export contract must preserve enough deterministic deposition information to reproduce the final image.

### Canonical export

Dedicated software rasterization/export must eventually provide deterministic raw RGBA output from canonical state/deposition records using defined integer compositing and sampling rules.

Export package should include:

- PNG image;
- raw-pixel hash in metadata/report;
- recipe JSON or sidecar;
- seed;
- schema/engine version;
- crop/frame dimensions;
- tick/time position;
- optional lineage metadata.

Large outputs should be tileable without seams or semantic differences.

---

## 9. Performance and compatibility targets

These are engineering targets, not permission to violate determinism.

### Interactive target

- 1920×1080 workspace;
- 60 FPS live interaction on a reasonable mid-2010s desktop-class CPU/GPU where feasible;
- planning baseline around 30,000 active simple agents, with graceful degradation and diagnostics;
- simulation backlog must be visible rather than silently changing tick semantics.

### Browser baseline

Target current Chromium and Firefox desktop browsers first. Avoid browser-specific APIs unless feature-detected.

### Memory

- typed arrays for hot canonical state;
- sparse/chunked field storage;
- bounded snapshot/checkpoint policy;
- explicit cache eviction that does not alter semantics.

### Profiling

Measure simulation tick cost, render cost, active agents, active chunks, deposition memory, and replay/export throughput before introducing architectural complexity.

---

## 10. Repository shape and engineering conventions

Preferred dependency-light shape:

```text
FIELDWEAVER/
├─ README.md
├─ AGENTS.md
├─ RAG.md
├─ package.json
├─ index.html
├─ src/
│  ├─ core/
│  ├─ fields/
│  ├─ materials/
│  ├─ renderer/
│  ├─ editor/
│  ├─ timeline/
│  ├─ lut/
│  ├─ export/
│  └─ ui/
├─ tests/
├─ fixtures/
├─ presets/
├─ scripts/
└─ docs/
```

Use native ES modules. Prefer plain JavaScript with rigorous JSDoc/types/contracts and Node's built-in test runner unless a later issue demonstrates that TypeScript or another build dependency materially improves reliability enough to justify itself.

Development/runtime should not require a framework. A tiny Node standard-library static server and Windows/POSIX launch scripts are preferred over a large dev-server dependency.

Keep canonical core modules DOM-free and importable by Node tests.

---

## 11. Roadmap and dependency graph

The roadmap is deliberately staged so each issue produces a coherent substrate rather than placeholder scaffolding.

### Phase A — trustworthy substrate

- **FW-001 — Repository/runtime foundation and quality gates**
- **FW-002 — Canonical deterministic simulation kernel** — depends on FW-001
- **FW-003 — Chunked field storage and deterministic authoring primitives** — depends on FW-002
- **FW-004 — Initial field operator library** — depends on FW-003
- **FW-005 — Agent/material/emitter simulation** — depends on FW-002 and FW-004
- **FW-006 — WebGL2 live renderer and deposition preview** — depends on FW-005

### Phase B — useful instrument

- **FW-007 — Instrument editor UI and direct manipulation** — depends on FW-003, FW-005, FW-006
- **FW-008 — LUT-as-logic subsystem** — depends on FW-004 and FW-005
- **FW-009 — Versioned recipe persistence and deterministic command model** — depends on FW-003, FW-005, FW-008
- **FW-010 — Timeline replay, checkpoints, scrubbing, and history integration** — depends on FW-009

### Phase C — exploration and output

- **FW-011 — Mutation lineage and variant comparison** — depends on FW-009 and FW-010
- **FW-012 — Canonical software raster export and provenance package** — depends on FW-006 and FW-009
- **FW-013 — Infinite Plate chunk streaming, crop discovery, and tiled export integration** — depends on FW-010 and FW-012
- **FW-014 — Presets, diagnostics, performance hardening, accessibility, and release readiness** — depends on FW-011, FW-012, FW-013

### Phase D — research gate

- **FW-015 — GPU simulation acceleration equivalence research** — depends on FW-014; research/optional optimization, never allowed to weaken canonical correctness.

Dependency summary:

```text
FW-001
  └─ FW-002
      └─ FW-003
          └─ FW-004
              └─ FW-005
                  └─ FW-006

FW-003 + FW-005 + FW-006 → FW-007
FW-004 + FW-005          → FW-008
FW-003 + FW-005 + FW-008 → FW-009
FW-009                    → FW-010
FW-009 + FW-010           → FW-011
FW-006 + FW-009           → FW-012
FW-010 + FW-012           → FW-013
FW-011 + FW-012 + FW-013  → FW-014
FW-014                    → FW-015
```

The sequence intentionally delays sophisticated UI until deterministic model boundaries exist, and delays Infinite Plate until replay/export semantics are trustworthy while still making chunk-awareness foundational.

---

## 12. Autonomous issue execution protocol

Every FW implementation issue is written so an autonomous agent can carry it through implementation, validation, PR, CI repair, merge, and verification.

Unless the issue explicitly says otherwise, the agent must:

1. Read the issue, `AGENTS.md`, this `RAG.md`, current `main`, and merged prerequisite implementations/tests.
2. Confirm prerequisites are actually merged.
3. Create a dedicated branch from current `main`.
4. Implement the complete issue acceptance criteria; do not stop at planning/scaffolding.
5. Add/update tests and docs.
6. Run all required local checks.
7. Open a PR linked to the issue with a precise summary and verification evidence.
8. Inspect automated checks; repair branch-caused failures without weakening gates.
9. Merge after all required automated checks pass. Autonomous merge is authorized by the maintainer.
10. Verify the merge landed on `main` and close the issue only when complete.

If a prerequisite or permission genuinely blocks completion, document the exact blocker in the issue/PR and leave the issue open.

---

## 13. Completion definition

An issue is complete only when:

- behaviour exists, not merely interfaces/stubs;
- acceptance criteria are covered by meaningful automated tests where testable;
- deterministic contracts have stable fixtures/hashes where applicable;
- user-facing behaviour is reachable in the app when the issue is user-facing;
- docs match implementation;
- no known issue-scope regression remains;
- local required checks pass;
- required GitHub automated checks pass;
- PR is merged to `main`;
- merged state is verified;
- issue is closed with no unresolved acceptance item.

---

## 14. Deferred extensions

These are intentionally outside the committed initial roadmap unless promoted by a later maintainer decision:

- reaction-diffusion fields;
- cellular automata feeding fields;
- image-derived flow/height fields;
- audio-derived fields;
- signed-distance geometry operators;
- symmetry/kaleidoscopic operators;
- particle collision and richer topology;
- branching/crawler/worm/glyph/spark materials;
- user-defined material DSL;
- WebGPU renderer;
- proven-equivalent GPU integer simulation;
- animated shader/post-processing stack;
- enormous offline render farms or distributed rendering;
- plugin ecosystem.

Deferred ideas must not distort the initial architecture unless the foundational choice is cheap and clearly beneficial.