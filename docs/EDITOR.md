# FIELDWEAVER instrument editor (`fw-editor-v1`)

FW-007 replaces the fixed demonstration with the first usable FIELDWEAVER instrument. The editor is an adapter over deterministic model APIs: DOM controls and pointer events describe authoring actions, but canonical fields, emitters, materials, seed, agents, and deposition remain model-owned.

## Creative loop

A fresh launch contains two vector field layers, the four baseline materials, and one Ink emitter. The intended loop is:

1. select or add a field layer;
2. choose **Paint** or **Erase** and author a vector field directly on the canvas;
3. add/place an emitter and assign a material;
4. tune field, emitter, material, seed, and brush controls;
5. run, pause, single-step, multi-step, or reset the deterministic simulation;
6. use field overlays, emitter markers, material trails, and diagnostics to inspect the result.

Authoring changes that affect simulation meaning pause and deterministically reset the live simulation to tick 0. This is deliberate until the later canonical timeline/command model exists: an editor click is not allowed to acquire hidden wall-clock timing semantics.

## Canvas tools

- **Pan [P]**: pointer drag moves the viewport only. Arrow keys also pan; `+`/`-` zoom.
- **Paint [B]**: pointer drag becomes one deterministic canonical brush stroke when released.
- **Erase [E]**: pointer drag erases vector-field cells through the same deterministic brush path.
- **Move field [V]**: drag/release moves the selected field origin as one authoring command.
- **Place emitter [N]**: pointer click creates a point emitter at that canonical world position.
- **Move emitter [M]**: drag/release moves the selected emitter origin.

The transparent 2D editor overlay displays painted cells, field origins, and emitter origins. It is view-only and never participates in simulation sampling or export truth.

## Field stack and painted-source semantics

FW-003 sparse vector cells are now part of operator sampling. For source operators (`uniform`, `attractor`, `vortex`, and `turbulence`), the local painted vector cell at the sampled world coordinate is saturated-added to that operator's procedural vector before normal layer blending. Empty cells therefore preserve every pre-FW-007 operator result exactly. `direction-quantizer` remains a stack transform and is not paintable.

Layer enable/reorder, brush strokes, selected field origin edits, and parameter edits use bounded authoring undo/redo commands. Structural create/delete currently clears the bounded authoring history so stale commands cannot target deleted stable IDs.

## Transport and scheduling

Canonical simulation advances only by integer ticks. The UI scheduler requests ticks at a 60-tick/second base rate multiplied by the selected speed (`0.25×` through `8×`). Speed changes scheduling only; they do not alter material, field, PRNG, integration, or deposition rules.

At most 16 pending scheduler ticks are processed per browser animation frame. If the browser cannot keep up, the remaining noncanonical scheduling debt is shown as **Scheduler backlog**. No elapsed-time value enters canonical transitions. Pausing/resetting or making an authoring edit explicitly clears scheduler debt; only ticks already passed to the deterministic simulation are canonical history.

Single-step and multi-step bypass wall-clock scheduling entirely and advance exact requested tick counts. Reset reconstructs the simulation from the currently recorded seed and authored definitions.

## Seed handling

The seed control always displays the concrete unsigned 32-bit root seed. **New recorded seed** uses browser cryptographic randomness only to choose a new concrete value; that value is immediately stored in editor state and included in the authoring hash before simulation is run. Canonical simulation never calls browser randomness.

## Authoring identity

`EditorSession.authoringHash()` covers the editor contract version, root seed, complete canonical field collection, material definitions, and emitter definitions. Viewport position, DOM state, renderer timing, GPU state, scheduler backlog, and current simulation tick are excluded.

The browser publishes this identity as `data-fieldweaver-canonical-recipe-hash` for acceptance instrumentation. Pan/zoom and renderer operations must leave it unchanged.

## Keyboard accessibility

Core actions have keyboard-reachable native controls and visible `:focus-visible` treatment. Global shortcuts are ignored while typing in an input/select/textarea.

- `Space`: run/pause
- `.`: exact single-step
- `Shift+.`: configured multi-step
- `R`: deterministic reset
- `Ctrl/Cmd+Z`: authoring undo
- `Ctrl/Cmd+Y` or `Ctrl/Cmd+Shift+Z`: authoring redo
- `P`, `B`, `E`, `V`, `N`, `M`: select canvas tools
- arrows: pan viewport
- `+` / `-`: zoom viewport

## Manual acceptance

Run `npm run serve` and exercise the following in both a current Chromium browser and Firefox:

1. Confirm the editor reaches `ready`, all named controls are keyboard focusable, and no console error is emitted.
2. Add a third field, select Paint, draw on the canvas, then undo and redo; the overlay and authoring hash must change consistently.
3. Disable and reorder a field, then undo; the field list must reflect the deterministic model order.
4. Place a second emitter on canvas, assign another material, change its rate, and edit that material's lifetime/deposition/steering values.
5. Run, pause, single-step, set multi-step, change speed, and reset. Tick count must be exact for step operations; reset returns to tick 0 without altering the authoring hash.
6. Pan/zoom and resize. The authoring hash must not change and stable deposition geometry must retain FW-016 cache reuse behaviour.
7. Re-enter the same concrete seed and perform the same authored setup/tick sequence; canonical simulation/deposition identity must reproduce.
8. If scheduler backlog is induced, confirm the debt is visible rather than silently changing tick semantics.

CI performs a browser subset of this workflow in both Chrome and Firefox in addition to DOM-free editor/model tests.
