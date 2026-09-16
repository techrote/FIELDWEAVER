# FIELDWEAVER timeline replay contract — FW-010

`fw-timeline-v1` adds interactive history navigation on top of the persistent `fw-recipe-v1` / `fw-command-v1` model from FW-009. It does **not** make the physics reversible and it does not add hidden persistent state to recipes.

## Canonical rule: seek means restore then replay

The playhead is an integer simulation tick. Moving it forward executes ordinary fixed-step recipe replay. Moving it backward never subtracts velocity, reverses deposition, un-applies random draws, or otherwise attempts inverse simulation.

A backward seek:

1. chooses the greatest valid cached checkpoint at or before the target tick;
2. restores that checkpoint into a new recipe replay instance;
3. replays ordinary deterministic commands/ticks forward to the requested tick.

If no useful cached checkpoint exists, tick 0 is always available and the recipe is replayed from its initial state.

For any target tick, cache size, seek order, and checkpoint eviction policy are performance inputs only. They are not canonical recipe inputs and may not change state, deposition, or result hashes.

## Checkpoints are transient memoization

Checkpoint schema identifier: `fw-replay-checkpoint-v1`.

Checkpoints are runtime-only objects and are deliberately absent from saved recipe JSON. A checkpoint captures enough state to reproduce subsequent canonical execution exactly:

- simulation tick and canonical active-agent records, including stable agent IDs;
- emitter PRNG words, spawn ordinals, spawned/dropped counters;
- current runtime material and emitter definitions after earlier commands;
- current field-layer state;
- current LUT mappings;
- frozen/unfrozen replay state;
- canonical deposition records and next deposition sequence;
- command-cursor/applied-command diagnostic information.

Restoration reconstructs typed agent storage, emitter PRNG instances, field/LUT/runtime definitions, and the deposition stream. The command cursor is recomputed against the **current** normalized recipe, so a checkpoint from an unchanged prefix cannot smuggle stale later command ordering into an edited timeline.

The default controller creates checkpoints every 32 ticks with a maximum of 12 retained checkpoints. Tick 0 is pinned. When the bound is exceeded, the oldest positive-tick checkpoint is evicted. These defaults are performance policy, not recipe semantics.

Diagnostics expose checkpoint count, retained ticks, estimated memory, eviction count, invalidation count, seek count, replayed ticks, and the most recent restore/replay path. The byte figure is an engineering estimate rather than a canonical serialized size.

## Timeline edits and invalidation

FW-009 commands remain ordered by `(tick, numeric command ID)`. FW-010 does not introduce a second order field.

When commands change, the controller finds the earliest tick whose normalized command set changed. Cached checkpoints at or after that tick are discarded conservatively. Earlier checkpoints may be reused because their executed prefix is unchanged. The target playhead is then reconstructed by restore + forward replay using the edited recipe.

Invalidating more checkpoints can cost time but cannot alter results. This conservative boundary rule intentionally avoids relying on subtle assumptions about event/checkpoint coincidence.

Non-command recipe edits (fields, materials, emitters, LUT assets, seed, imported recipe data) replace the semantic initial state and therefore reset the checkpoint cache to the new tick-0 state.

## Same-tick reordering

Within one tick, numeric command ID is the canonical order key established by FW-009. The timeline UI's **Earlier same tick** / **Later same tick** operations therefore swap the IDs of adjacent same-tick commands and immediately revalidate the complete recipe.

There are no opaque DOM-only ordering rules. Save/load preserves the resulting IDs and therefore preserves the visible order.

## Timeline edit history is not physics undo

Timeline event editing has its own bounded history (`64` entries by default). A history entry stores validated command arrays before and after one event edit.

Timeline undo/redo changes the recipe command list and reconstructs the current playhead through replay. It does not reverse simulated state. This history is intentionally separate from field-paint/authoring undo in `AuthoringHistory`.

## UI and transport

The Timeline sidebar provides:

- integer playhead slider and target-tick seek;
- visible current tick/frozen state;
- view-start and 64/256/1024/4096-tick range controls;
- an ordered event list displaying tick, numeric ID, and command type;
- add/edit/delete controls for all FW-009 command types;
- same-tick earlier/later controls;
- dedicated timeline undo/redo;
- checkpoint/replay diagnostics.

All controls are native keyboard-reachable form controls/buttons. Existing Run/Pause, speed, exact single-step, multi-step, and reset remain authoritative transport controls. Speed affects scheduler demand only; it does not change canonical tick equations. Timeline seeks/edits pause execution and clear outstanding scheduler debt before the next run.

## Preview accumulation after a backward seek

The WebGL renderer remains noncanonical. It synchronizes against the canonical deposition array. If replay replaces the prior deposition tail or produces a shorter array after a backward seek, `WebGL2PreviewRenderer` detects the mismatch and rebuilds its bounded preview accumulator/geometry from the new canonical deposition stream.

No framebuffer or preview cache is restored as canonical state.

## Test obligations

FW-010 tests compare fresh start-to-target replay with direct forward execution and checkpoint-assisted seeks over mixed forward/backward target orders. They additionally exercise:

- bounded-cache eviction with different cache sizes;
- exact restoration of emitter PRNG and agent/deposition state;
- earlier-event invalidation and replay to the existing playhead;
- same-tick ID ordering/reordering;
- separate timeline edit undo/redo;
- browser keyboard/control availability and backward-seek preview rebuilding.

A failure in any state/deposition/result hash comparison is a correctness defect, not an acceptable cache variance.
