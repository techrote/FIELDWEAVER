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

The artist paints invisible scalar/vector fields and masks, releases simulated materials into them, runs a deterministic simulation, intervenes over time, freezes or layers results, mutates recipes, compares variants, and exports selected compositions.

Primary creative loop:

> Paint field → release material → run → intervene → freeze/layer → mutate → compare → export

The product must feel like an instrument, not a parameter form. Direct canvas interaction, immediate feedback, keyboard control, inspectable state, and deterministic experimentation are core qualities.

The first useful release should support:

- multiple ordered field layers;
- five field operators;
- four materially distinct agent types;
- deterministic emitters and seeded simulation;
- run/pause, speed control, single-tick stepping, reset, and seed control;
- LUT-driven colour and behaviour modulation;
- save/load of complete recipes;
- deterministic timeline replay;
- mutation/forking of recipes;
- canonical PNG export plus recipe provenance;
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
- Canonical image export consumes canonical replay/deposition data; it never reads a WebGL framebuffer as image truth.
- Every persistent format is versioned and validated.
- User-visible noncanonical modes must identify themselves explicitly.
- New dependencies require justification. Prefer browser APIs and Node standard library for tooling/tests.
- The app is offline-capable after checkout/download and local launch.

---

## 3. Plan review and corrected architecture

The original concept proposed GPU-side simulation where practical. Review identified several architectural risks and corrected them before implementation.

### Review finding A — GPU floating point conflicts with exact determinism

WebGL/WebGPU implementations, shader compilers, floating-point contraction/precision, and driver behaviour can differ. Therefore GPU floating-point simulation cannot define canonical state.

**Correction:** canonical simulation runs in JavaScript using explicit 32-bit integer/fixed-point arithmetic, deterministic lookup tables, and an engine-owned seeded PRNG. WebGL2 renders the live result. A future GPU simulator is permitted only as either:

1. a noncanonical preview/accelerator clearly marked as such; or
2. a proven-equivalent integer path with conformance tests against the canonical implementation.

### Review finding B — “Infinite Plate later” can force a destructive rewrite

A finite monolithic coordinate model would make later unbounded/chunked space invasive.

**Correction:** world coordinates and field storage are chunk-aware from the first simulation/data-model issues. The UI may expose a bounded working region, but persistent identities and coordinates do not assume a single finite texture/canvas.

### Review finding C — replay cannot be bolted onto mutable editor state

If live interventions directly mutate state without a command/event model, save/load and timeline replay become ambiguous.

**Correction:** persistent user actions that affect canonical simulation are represented as validated deterministic commands. Timeline seeking restores known state and replays forward; it never numerically reverses nonreversible simulation equations.

### Review finding D — “same artwork” needs two reproducibility tiers

Exact simulation state can be deterministic while WebGL rasterization and PNG compression differ.

**Correction:** define two guarantees:

- **Canonical state determinism:** same engine/schema version + recipe + seed + command timeline produces identical canonical state hashes.
- **Canonical image determinism:** the dedicated software export path produces identical row-major RGBA8 pixels for the same canonical inputs. The raw RGBA hash is the image oracle. PNG compression/file bytes are packaging and may change in a future compatible encoder without changing decoded pixels.

The interactive WebGL2 preview is visually faithful but is not the canonical pixel oracle.

### Review finding E — mutation must operate on recipes, not opaque state

Mutation of raw simulation memory would be difficult to reason about or reproduce.

**Correction:** mutations are explicit deterministic transformations of recipe parameters and/or seed lineage. Every child records parent identity plus mutation operations, and sibling comparisons use isolated replay instances.

### Improved architecture

Four hard subsystem boundaries:

1. **Model/core** — deterministic recipe schema, field definitions, commands, PRNG, fixed-step simulation, snapshots/hashes.
2. **Editor** — tools, selection, field painting, inspectors, history, timeline authoring, mutation controls.
3. **Renderer** — WebGL2 preview, display compositing, overlays, picking support; read-only with respect to canonical model state.
4. **Export** — canonical software raster path, raw-pixel identity, PNG packaging, recipe/provenance sidecar, crop/tile handling.

The model/export cores remain headlessly testable under Node without a DOM or GPU.

---

## 4. Canonical determinism contract

### Fixed-step clock

Simulation advances only by integer ticks. UI speed changes how many canonical ticks are requested per unit wall time; it never changes tick duration or equations.

Pause stops tick advancement. Single-step advances exactly one tick. Reset restores a deterministic initial state from the current recipe/seed.

### Numeric representation

Canonical simulation avoids ordinary floating-point arithmetic in state transitions.

Compatibility baseline:

- chunk coordinates: signed 32-bit integers;
- local position/velocity: signed 32-bit Q16.16 fixed-point integers;
- field samples/strengths: explicit bounded integer/fixed-point formats;
- counters, IDs, and seeds: unsigned/signed 32-bit integers as appropriate;
- multiplication/division helpers specify saturation and rounding behaviour;
- normalized-direction/trigonometric-like behaviour uses checked-in integer tables or deterministic integer algorithms.

FW-002 established the concrete numeric contract and later issues preserve it.

### PRNG

Canonical randomness uses the specified model-owned xoshiro128** implementation and deterministic seed derivation/substreams. No `Math.random()` is permitted in canonical code.

Distinct stable streams prevent unrelated features from perturbing one another merely because call counts changed. Stream identity derives from stable IDs/seed material where practical.

### Ordering

Any iteration where order affects results has a defined order: stable numeric IDs, canonical sequence numbers, array index order where contractual, or an explicitly sorted key. Canonical results never rely on accidental object/map iteration order.

### Hashes and fixtures

Stable canonical serialization/hashing supports fixtures. Tests cover, as applicable:

- PRNG test vectors;
- arithmetic edge cases;
- repeated-run state hashes;
- save/load/replay equivalence;
- command-timeline replay equivalence;
- mutation child identities;
- raw RGBA pixel hashes;
- selected end-to-end golden results.

### Versioning

Recipes and canonical state/image semantics carry compatibility versions. A newer runtime must not silently reinterpret an incompatible older recipe or raster contract. Migrations/compatibility changes must be explicit and tested.

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

A logical position is chunk-aware:

`(chunkX, chunkY, localX, localY)`

Local coordinates are normalized when crossing chunk boundaries. Stable world-space identities permit streaming/culling/cropping without changing recipe meaning.

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

Field painting uses sparse/chunked storage rather than a mandatory world-sized texture. Initial chunks use fixed-resolution deterministic scalar/vector grid storage and brush rasterization.

### Agents/materials

Simulation agents use structure-of-arrays typed storage for predictable performance and iteration order. Each agent has stable identity and the minimum canonical state needed by its material behaviour.

Material definitions describe behaviour families rather than decorative sprite swaps.

### Emitters

Emitters deterministically generate agents from explicit schedules, masks/geometry, material references, rates/bursts, and seed substreams. Spawn ordering is specified.

### Depositions

Canonical deposition records are renderer-independent and contain the ordered information required to reproduce artwork: tick/sequence, material/primitive identity, chunk-aware from/to positions, radius, strength, and optional LUT-resolved RGBA8 colour. Numeric deposition `sequence` is the canonical compositing order for FW-012 export.

### Commands

Canonical interventions are validated commands such as:

- change parameter at tick N;
- enable/disable field at tick N;
- alter emitter rate at tick N;
- release a deterministic burst at tick N;
- freeze/resume at tick N;
- change LUT mapping at tick N.

Purely visual editor actions such as panning do not belong in canonical command history.

---

## 6. Fields, materials, emitters, and LUT logic

### Initial field operators

1. **Uniform / gravity vector** — constant directional influence.
2. **Attractor / repulsor** — point or painted-source radial influence with deterministic falloff.
3. **Vortex / curl** — rotational influence around a point/painted source.
4. **Turbulence / noise** — seeded deterministic integer noise sampled in world coordinates.
5. **Direction quantizer** — snaps/steers movement toward deterministic angular sectors.

Field composition order is explicit and uses specified integer arithmetic/blend rules.

### Initial materials

- **Ink** — continuous deposition, moderate inertia, density accumulation.
- **Filament** — connected/long-lived trails with stronger directional persistence.
- **Dust** — discrete point deposition/cloud behaviour, shorter lifetime.
- **Shard** — quantized/segment-like travel with abrupt directional changes.

Material differences are behavioural and testable.

### LUT-as-logic

A LUT is a deterministic sampled data asset, not only a colour palette. LUT channels can drive:

- colour;
- lifetime multiplier;
- turn/steering strength;
- deposition strength;
- canonical export radius;
- later material/glyph family selection where explicitly added.

Mappings define input source, channel, integer scale/range, clamp/wrap behaviour, and destination. Sampling/indexing is deterministic. Common 256/512-entry workflows are supported without fixing one global LUT size.

For canonical export, a deposition's LUT-resolved `colorRgba8` is authoritative. If absent, FW-012 uses its versioned canonical material fallback colour table.

---

## 7. Editor, timeline, mutation, and Infinite Plate

### Editor interaction

Baseline tools include:

- field layer create/delete/reorder/enable;
- direct canvas brush painting and erasing;
- select/move/edit field controls;
- emitter placement/editing;
- material selection/editing;
- seed edit/randomize-with-recorded-value;
- run/pause;
- simulation speed control;
- single-tick and configurable multi-tick stepping;
- deterministic reset;
- zoom/pan without affecting canonical state;
- bounded authoring undo/redo.

Keyboard access is required for core controls.

### Timeline

The timeline is linear and displays deterministic command events against simulation ticks. Same-tick order is canonical `(tick, numeric command ID)` order.

Backward scrubbing restores tick 0 or a valid bounded transient checkpoint then replays commands/ticks forward. It never guesses state by reversing equations. Checkpoint presence, spacing, or eviction is memoization only and cannot alter results. Timeline edit undo/redo is separate from field authoring history.

### Mutation lineage

Mutation creates validated recipe children. Lineage records parent recipe identity/hash, deterministic mutation operations, child seed, and child identity/hash.

FW-011 supports deterministic bounded mutation across numeric parameters, fields, emitter/control placement, adjacent field order, LUT/mapping choice, and sibling seed derivation. Mutation selection/magnitude uses explicit seed/substream configuration. Parent/sibling snapshots remain isolated and immutable from child editing.

### Infinite Plate

The later Infinite Plate feature presents an effectively unbounded chunked plane. Requirements:

- chunk identity derives only from world coordinates and recipe/seed data;
- simulation activation/culling must not change results inside a requested canonical region;
- field data remains sparse and chunk-addressed;
- camera/navigation never defines simulation truth;
- user can pan far from origin, discover structures, and frame a crop without rebasing world coordinates;
- finite crop export must not require the whole plate in memory;
- chunk cache eviction is nonsemantic.

The early core does not expose endless navigation yet, but its chunk/world/export contracts must not preclude these guarantees.

---

## 8. Rendering and export

### Live renderer

The live renderer is WebGL2.

Responsibilities:

- native-resolution canvas with device-pixel-ratio handling;
- efficient drawing of canonical deposition records and editor overlays;
- visual compositing of field/material output;
- viewport pan/zoom;
- diagnostics;
- no mutation of canonical simulation state.

The WebGL2 preview is explicitly **noncanonical**. GPU floating point, framebuffer contents, preview truncation, geometry caches, camera state, and render timing are not inputs to canonical state or canonical export.

### Deposition representation

The simulation preserves canonical renderer-independent deposition records. Live preview may keep bounded GPU/CPU caches, but those caches are never the only source of artwork truth. FW-012 software export replays the recipe to a target tick and consumes the resulting canonical deposition sequence directly.

### Canonical export — FW-012 compatibility contract

FW-012 establishes:

- export package `fw-canonical-export-v1`;
- software raster `fw-canonical-raster-v1`;
- provenance `fw-export-provenance-v1`;
- PNG package `fw-png-rgba8-v1`.

The canonical image oracle is the **decoded row-major RGBA8 byte buffer**. `rawRgbaHash()` is FNV-1a-64 over those bytes. PNG bytes are packaging and are not the compatibility oracle.

Export normalizes the recipe/crop, performs deterministic replay from recipe initial state to explicit integer `targetTick`, then rasterizes deposition records in numeric `sequence` order. It does not inspect WebGL, Canvas2D, a framebuffer, camera state, or DOM rendering.

Crop framing is independent of the viewport and consists of width/height, chunk-aware world centre, and Q16.16 units per pixel. Pixel centres are mapped with doubled integer Q16 coordinates so half-pixel positions require no floating point; world +Y maps upward while raster row indices increase downward.

Canonical primitives:

- point/disc: closed disc coverage at the deposition `to` position;
- segment: closed capsule from `from` to `to` with round end caps.

Coverage uses integer/BigInt squared-distance, projection, and cross-product comparisons. There is no antialiasing or GPU sampling in the canonical path.

Colour/compositing:

- use deposition `colorRgba8` when present, otherwise the versioned material fallback colour;
- default background is opaque `[9, 11, 8, 255]`;
- effective alpha is colour alpha multiplied by `strengthQ16`, Q16 half-up rounded and clamped to `[0,255]`;
- covered pixels composite in sequence order with integer source-over RGB: `floor((src*alpha + dst*(255-alpha) + 127) / 255)`;
- canonical output alpha remains 255.

Tiling is nonsemantic. Single-pass and tiled assembled rasterization must be byte-identical, and `iterateRasterTiles()` provides the bounded-memory path. Current safeguards allow crop axes up to 100,000 px, cap assembled output at 16,777,216 pixels, and require tile iteration for larger valid crops. Tile dimensions/origin cannot change pixel meaning or introduce seams.

The current dependency-free PNG encoder writes non-interlaced RGBA8, filter-0 scanlines and zlib stored DEFLATE blocks with CRC-32/Adler-32 validation. Tests decode the PNG back to byte-identical canonical RGBA8.

The provenance sidecar records the normalized recipe and hash, seed, recipe/engine/export/raster/PNG versions, target tick, crop/scale/dimensions, background, raw RGBA hash, canonical state/deposition/result hashes, and lineage when present.

Replay/deposition capacity is explicit. If export cannot reach the requested tick within the configured canonical deposition bound, it fails loudly; it never truncates silently or falls back to a noncanonical framebuffer capture.

See `docs/EXPORT.md` for exact pixel equations, fallback colours, memory bounds, UI behavior, and packaging details.

---

## 9. Performance and compatibility targets

These are engineering targets, not permission to violate determinism.

### Interactive target

- 1920×1080 workspace;
- 60 FPS live interaction on a reasonable mid-2010s desktop-class CPU/GPU where feasible;
- planning baseline around 30,000 active simple agents, with graceful degradation and diagnostics;
- simulation backlog must be visible rather than silently changing tick semantics.

### Browser baseline

Target current Chromium and Firefox desktop browsers first. Avoid browser-specific APIs unless feature-detected. Canonical model/export correctness must remain headlessly testable without either browser.

### Memory

- typed arrays for hot canonical state;
- sparse/chunked field storage;
- bounded snapshot/checkpoint policy;
- bounded preview accumulation;
- export full-assembly guard plus tile iterator;
- explicit cache eviction that does not alter semantics.

### Profiling

Measure simulation tick cost, render cost, active agents/chunks, deposition/checkpoint/cache memory, replay throughput, and export throughput before introducing architectural complexity.

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

Use native ES modules. Prefer plain JavaScript with rigorous contracts and Node's built-in test runner unless a later issue demonstrates that a new language/build dependency materially improves reliability enough to justify itself.

Development/runtime should not require a framework. A tiny Node standard-library static server and Windows/POSIX launch scripts are preferred over a large dev-server dependency.

Keep canonical core/export modules DOM-free and importable by Node tests. Dependencies require a concrete justification and may not redefine canonical semantics.

---

## 11. Roadmap and dependency graph

The roadmap is staged so each issue produces a coherent substrate rather than placeholder scaffolding.

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
3. Create or recover a dedicated branch from current `main`; never overwrite another actor's substantive work blindly.
4. Implement the complete issue acceptance criteria; do not stop at planning/scaffolding.
5. Add/update tests and docs, including compatibility architecture when semantics become concrete.
6. Run all required checks.
7. Open a PR linked to the issue with a precise summary and verification evidence.
8. Inspect automated checks; repair branch-caused failures without weakening gates.
9. Merge only after all required automated checks pass. Autonomous merge is authorized by the maintainer.
10. Verify the exact merge landed on `main`, verify post-merge checks where available, and close the issue only when complete.

If a prerequisite, permission, environment, or external service genuinely blocks completion, document the exact blocker in the issue/PR and leave the issue open.

---

## 13. Completion definition

An issue is complete only when:

- behavior exists, not merely interfaces/stubs;
- acceptance criteria are covered by meaningful automated tests where testable;
- deterministic contracts have stable fixtures/hashes where applicable;
- user-facing behavior is reachable in the app when the issue is user-facing;
- docs and architecture context match implementation;
- no known issue-scope regression remains;
- required checks pass;
- required GitHub automated checks pass;
- PR is merged to `main`;
- merged state and post-merge checks are verified where available;
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
