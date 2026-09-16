# FIELDWEAVER instrument editor (`fw-editor-v1`)

FW-007 established the direct-manipulation instrument. FW-008 added LUT authoring, FW-009 added portable recipes/commands, and FW-010 adds deterministic timeline navigation while preserving the original editor boundary: DOM controls and pointer events describe authoring actions, but canonical fields, emitters, materials, seed, commands, agents, and deposition remain model-owned.

## Creative loop

A fresh launch contains two vector field layers, the four baseline materials, deterministic LUT examples, and baseline emitters. The intended loop is:

1. select or add a field layer;
2. choose **Paint** or **Erase** and author a vector field directly on the canvas;
3. add/place an emitter and assign a material;
4. tune field, emitter, material, LUT, seed, and brush controls;
5. run, pause, single-step, multi-step, or reset the deterministic simulation;
6. author deterministic intervention events in **Timeline** and seek/replay to useful ticks;
7. use field overlays, emitter markers, material trails, checkpoint/replay diagnostics, and the live preview to inspect the result;
8. save the normalized recipe when the authored state/timeline is worth preserving.

Non-command authoring changes establish a new recipe initial state. They pause execution and rebuild timeline replay/checkpoint state from tick 0. Timeline command edits are different: FW-010 preserves the current playhead by invalidating affected checkpoints and replaying the edited recipe back to that tick.

## Canvas tools

- **Pan [P]**: pointer drag moves the viewport only. Arrow keys also pan; `+`/`-` zoom.
- **Paint [B]**: pointer drag becomes one deterministic canonical brush stroke when released.
- **Erase [E]**: pointer drag erases vector-field cells through the same deterministic brush path.
- **Move field [V]**: drag/release moves the selected field origin as one authoring command.
- **Place emitter [N]**: pointer click creates a point emitter at that canonical world position.
- **Move emitter [M]**: drag/release moves the selected emitter origin.

The transparent 2D editor overlay displays painted cells, field origins, and emitter origins. It is view-only and never participates in simulation sampling or export truth.

## Field stack and painted-source semantics

FW-003 sparse vector cells are part of operator sampling. For source operators (`uniform`, `attractor`, `vortex`, and `turbulence`), the local painted vector cell at the sampled world coordinate is saturated-added to that operator's procedural vector before normal layer blending. Empty cells therefore preserve pre-FW-007 operator results exactly. `direction-quantizer` remains a stack transform and is not paintable.

Layer enable/reorder, brush strokes, selected field origin edits, and parameter edits use bounded authoring undo/redo commands. Structural create/delete currently clears bounded authoring history so stale commands cannot target deleted stable IDs.

Authoring undo/redo remains distinct from FW-010 timeline undo/redo. Timeline history changes the command list and reconstructs the playhead by replay; it never tries to invert simulated physics.

## Transport and scheduling

Canonical simulation advances only by integer ticks. The UI scheduler requests ticks at a 60-tick/second base rate multiplied by the selected speed (`0.25×` through `8×`). Speed changes scheduling only; it does not alter material, field, LUT, PRNG, integration, command, or deposition rules.

At most 16 pending scheduler ticks are processed per browser animation frame. If the browser cannot keep up, the remaining noncanonical scheduling debt is shown as **Scheduler backlog**. No elapsed-time value enters canonical transitions. Pausing/resetting or making a semantic authoring/timeline edit clears scheduler debt; only ticks already passed to deterministic replay are canonical history.

Single-step and multi-step bypass wall-clock scheduling entirely and advance exact requested tick counts. Reset returns deterministic replay to tick 0 under the current recipe.

The **Timeline** playhead uses the same tick domain. A forward seek executes ordinary replay. A backward seek restores a valid bounded checkpoint (or tick 0) and replays forward. It never numerically reverses simulation equations. Existing Run/Pause, speed, single-step and multi-step controls continue from the current playhead.

## Timeline controls

The timeline sidebar provides native keyboard-reachable controls for:

- playhead and numeric target-tick seek;
- visible range start and 64/256/1024/4096-tick spans;
- ordered event inspection by `tick`, then numeric command `id`;
- adding, JSON-editing, deleting, and same-tick reordering of FW-009 command types;
- separate timeline undo/redo;
- checkpoint count/memory estimate, eviction/invalidation counts, seek count and replay-tick diagnostics.

Same-tick **Earlier/Later** swaps numeric IDs of adjacent events because `(tick,id)` is the persistent `fw-command-v1` ordering contract. There is no DOM-only order that can disappear on save/load.

See [`TIMELINE.md`](./TIMELINE.md) for checkpoint restoration and invalidation details.

## Seed handling

The seed control always displays the concrete unsigned 32-bit root seed. **New recorded seed** uses browser cryptographic randomness only to choose a new concrete value; that value is immediately stored in recipe/editor state before simulation is run. Canonical simulation never calls browser randomness.

## Recipe identity

The current authoring/recipe identity covers the normalized FW-009 recipe: root seed, framing, complete field collection, materials, emitters, LUT assets/mappings, commands and lineage. Viewport position, DOM state, renderer timing, GPU state, scheduler backlog, playhead tick, checkpoint cache, and both undo stacks are excluded.

The browser publishes this identity as `data-fieldweaver-canonical-recipe-hash` for acceptance instrumentation. Pan/zoom, seeking and renderer operations must leave it unchanged unless the actual recipe is edited.

## Keyboard accessibility

Core actions use keyboard-reachable native controls and visible `:focus-visible` treatment. Global shortcuts are ignored while typing in an input/select/textarea.

- `Space`: run/pause
- `.`: exact single-step
- `Shift+.`: configured multi-step
- `R`: deterministic reset
- `Ctrl/Cmd+Z`: field/authoring undo
- `Ctrl/Cmd+Y` or `Ctrl/Cmd+Shift+Z`: field/authoring redo
- `P`, `B`, `E`, `V`, `N`, `M`: select canvas tools
- arrows: pan viewport
- `+` / `-`: zoom viewport

Timeline controls are ordinary form elements/buttons and are reachable by normal Tab navigation. Timeline undo/redo has explicit buttons so it is not conflated with the global authoring shortcuts.

## Manual acceptance

Run `npm run serve` and exercise the following in both a current Chromium browser and Firefox:

1. Confirm the editor and timeline reach `ready`, all named controls are keyboard focusable, and no console error is emitted.
2. Add a field, select Paint, draw on the canvas, then undo and redo; overlay and recipe identity must change consistently.
3. Place an emitter, assign another material, change its rate, and edit material/LUT values.
4. Add at least two same-tick timeline events. Confirm the list orders them by numeric ID; use Earlier/Later and timeline undo/redo to change/restore that visible persistent order.
5. Run/pause/single-step/multi-step/change speed/reset. Exact-step tick counts must remain exact and the playhead must track them.
6. Run far enough to create at least one positive-tick checkpoint, then seek backward. Diagnostics must show restore + forward replay, recipe identity must not change, and the preview must rebuild from the shortened/replaced canonical deposition stream.
7. Edit an event earlier than retained checkpoints. Confirm affected cache entries are invalidated and the current playhead is reconstructed under the edited recipe.
8. Pan/zoom and resize. Recipe identity must not change and stable deposition geometry must retain FW-016 cache reuse behaviour when canonical deposition history itself is unchanged.
9. Save/load the recipe and replay to the same target tick; canonical state/deposition results must reproduce independently of checkpoint history.

CI performs browser subsets of the editor and timeline workflows in both Chrome and Firefox in addition to DOM-free deterministic replay/cache tests.
