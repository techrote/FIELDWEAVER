# Recipes, command timelines, and compatibility

FW-009 establishes the portable canonical creative-work format and the replayable intervention model. FW-010 adds timeline navigation and checkpoint-assisted execution **without changing the persistent recipe schema**.

## Format identity

Current persistent versions:

- recipe schema: `fw-recipe-v1`
- canonical simulation engine compatibility: `fw-agents-v1`
- command schema: `fw-command-v1`
- migration framework: `fw-recipe-migrations-v1`

FW-010 runtime timeline/checkpoint identifiers (`fw-timeline-v1`, `fw-replay-checkpoint-v1`) are transient implementation contracts, not recipe fields. See [`TIMELINE.md`](./TIMELINE.md).

A recipe is accepted only after complete validation. An unknown recipe schema or engine compatibility version fails loudly. The migration registry is explicit: a historical schema is never guessed or silently reinterpreted. The checked-in `fixtures/fw-009-incompatible-recipe.json` fixture proves the deliberately unsupported `fw-recipe-v0` path remains rejected until a real migration is registered and tested.

## Canonical recipe shape

A normalized recipe contains, in stable semantic form:

```text
schemaVersion
engineVersion
seed
framing
  widthPx
  heightPx
  center { chunkX, chunkY, localX, localY }
  unitsPerPixelQ16
fields
materials[]
emitters[]
lut
  schemaVersion
  assets[]
  mappings[]
commands[]
lineage | null
```

`fields` is the complete ordered `fw-fields-v1` sparse field collection, including painted cells. Material, emitter and LUT records are revalidated through their authoritative model constructors before a recipe becomes live. Framing is persistent creative intent but does not affect canonical simulation equations.

Optional lineage currently records a 16-character parent recipe hash, child seed and canonical-safe mutation operation records. FW-011 can build deterministic mutation workflows on this substrate without changing recipe identity semantics.

## Identity and serialization

`recipeHash()` hashes the **normalized recipe**, not raw input JSON. Normalization validates and canonicalizes model records, orders commands by their semantic replay order, and uses the repository canonical serializer, whose plain-object keys are sorted before FNV-1a-64 hashing. Incidental JavaScript property construction order therefore cannot change recipe identity.

`serializeRecipe()` emits normalized, human-readable JSON with a trailing newline. Parsing and reserializing an accepted recipe is stable. The hash covers the root seed, field data/order, materials, emitters, LUT assets/mappings, framing, command timeline and lineage.

Authoring undo/redo history, timeline edit undo/redo history, and replay checkpoints are intentionally excluded. Those are transient editor/runtime workflow state; the resulting authored field data and command list are canonical and are included.

## Command ordering and tick semantics

Every command has a nonzero stable unsigned 32-bit `id`, an unsigned tick, a command schema version and a known type. IDs are unique across a timeline. Normalization sorts commands by `(tick, id)`. That is the authoritative same-tick order: smaller command IDs execute first, so later IDs observe and may deliberately override earlier same-tick changes.

Commands for tick `N` are applied **before** the canonical transition from tick `N` to `N + 1`. Replay never uses wall-clock time, animation-frame time, DOM order or object enumeration order.

The initial command set is:

- `set-material-parameter` — changes a validated canonical material parameter. Existing agents observe parameters consulted per tick; spawn-captured values such as lifetime retain the value captured at spawn.
- `set-field-enabled` — enables/disables one field layer in replay state.
- `set-emitter-rate` — changes one emitter's deterministic scheduled rate.
- `release-burst` — adds an exact count to that emitter's burst at the command tick, before spawning for that tick.
- `set-simulation-frozen` — freezes or resumes canonical evolution. Timeline ticks continue while frozen so a later resume command has an exact reachable tick; agents, emitters and deposition do not advance during frozen transitions.
- `set-lut-mapping` — atomically replaces or removes one material/destination LUT mapping after full LUT/material validation.

The base authoring definitions remain separate from replay state. Running a timeline mutates only the replay instance; resetting reconstructs or seeks replay from the current normalized recipe.

FW-010 exposes same-tick reordering by swapping the numeric IDs of adjacent same-tick commands. No second hidden order field exists, so save/load preserves exactly the order shown by the timeline UI.

## Transactional load

Browser load/import parses and validates the complete candidate recipe and constructs a candidate deterministic replay before replacing the editor's active project. Any JSON, schema, cross-reference, command or compatibility error leaves the live project unchanged.

The editor exposes **Save recipe** and **Load recipe** controls. Save downloads normalized JSON named with its canonical recipe hash. Load accepts local JSON, performs transactional import, then resets the live view to tick zero under the imported recipe. No network service is involved.

Loading a recipe also replaces transient timeline checkpoint/edit-history state. Saved recipes do not depend on previously cached snapshots.

## Replay guarantee

For the same normalized recipe, capacities and target tick, fresh replays apply the same command sequence and produce identical canonical simulation state and deposition hashes. FW-010 extends this guarantee: direct forward execution, replay from tick zero, and checkpoint-assisted seek must reach identical state/deposition/result hashes for the same target tick. Cache size, checkpoint spacing, eviction, and prior navigation history are nonsemantic.

Tests exercise a nontrivial recipe containing multiple fields, all baseline materials, multiple emitters, multiple LUT assets/mappings and commands, then compare original/save-load and timeline replay paths at the same ticks.

Recipe identity is not a renderer identity. The WebGL2 preview remains noncanonical; after a backward seek it rebuilds from the new canonical deposition stream when its previous accumulation no longer matches. Later canonical software export consumes canonical simulation/deposition data plus framing.
