# Deterministic field storage and authoring contract — FW-003

FW-003 adds the first canonical authored-field substrate on top of `fw-canonical-v1`. The model is DOM-free and uses sparse, chunk-addressed integer data. GPU textures may later cache or visualize this data, but they are never authoritative.

## Format and layer identity

The serialized field collection format identifier is `fw-fields-v1`.

A collection owns stable unsigned layer IDs. ID `0` is invalid and `4294967295` is reserved as the exhausted next-ID sentinel, so normal IDs are `1..4294967294`. IDs are monotonic and are not reused after deletion. Layer order is an explicit array of IDs; insertion appends, `moveLayer` changes only this order, and enabled state is an explicit boolean. Both order and enabled state contribute to the canonical field hash.

Each layer records:

- `kind`: `scalar` (one signed int32 channel) or `vector` (two signed int32 channels);
- `operator`: a stable string, initially `painted`;
- `enabled` and `blend` (`replace`, `add`, `min`, or `max`);
- `cellsPerChunk`: an integer divisor of 256 in `[1, 256]`;
- a chunk-aware world origin plus positive Q16.16 X/Y scale in `transform`;
- sorted named signed-int32 `parameters`;
- sparse non-zero chunk/cell data.

The operator library introduced later consumes these definitions; FW-003 establishes storage and authoring semantics only.

## Grid and chunk addressing

The canonical world chunk remains the FW-002 256-logical-cell chunk. A field layer chooses a regular grid resolution with `cellsPerChunk`; therefore one field cell spans `256 / cellsPerChunk` logical world cells.

A field cell address is `(chunkX, chunkY, cellX, cellY)`. Input cell coordinates may be outside the local range and are normalized with mathematical floor semantics. For a 256-cell field, `(0, 0, -1, 0)` normalizes to `(-1, 0, 255, 0)`. This makes seam crossing and negative coordinates unambiguous.

Runtime storage allocates a dense typed-array chunk only after the first non-zero channel is written in that chunk. All-zero writes to untouched regions allocate nothing. When the final non-zero channel of a runtime chunk is cleared, the chunk is removed again. There is no mandatory world-sized array or texture.

Canonical serialization does not dump zero-filled runtime arrays. Chunks are sorted by `(chunkY, chunkX)` and contain only non-zero cells, sorted by row-major linear cell index. This sparse representation is hashed through the existing canonical serializer.

## Deterministic brush contract

Brush authoring is expressed against integer field-grid coordinates, not frame time or raw pointer-event cadence. A stroke is a polyline of canonical grid points (or equivalent chunk/cell addresses). Each segment is rasterized with deterministic integer Bresenham traversal; visited centers are de-duplicated and sorted before painting. Equivalent subdivision of the same canonical path therefore produces the same center set and result.

Brush parameters are validated and bounded:

- operations: `set`, `add`, `erase`;
- shapes: `circle`, `square`;
- falloff: `flat`, `linear-ring`;
- radius: integer `0..64` grid cells;
- scalar/vector values: signed int32 channels.

`linear-ring` uses deterministic integer distance rings. Circle membership uses squared integer distance and an integer square-root loop; square distance uses the Chebyshev metric. The weight is Q16.16. Set/erase interpolation and weighted addition use exact `BigInt` intermediates, half-away-from-zero rounding, and signed-int32 saturation. No `Math.random()`, wall-clock time, frame delta, DOM state, or GPU state is consulted.

A canonical stroke is capped at 1,000,000 unique grid centers to reject accidental unbounded authoring work rather than hanging or silently truncating it.

## Authoring history

`AuthoringHistory` is deliberately separate from the future simulation command/timeline model. It stores explicit reversible authoring commands and is bounded by an entry count (default 128, configurable up to 4096). Brush commands store cell patches containing exact before/after channel values. Layer enable and layer-order commands store their exact before/after state.

Undo applies the captured `before` state; redo applies `after`. For brush edits this guarantees undo then redo returns to the identical field hash. Executing a new command clears redo history. Oldest undo commands are evicted when the configured bound is exceeded; eviction changes edit convenience only, never canonical field state.

## Hashing and compatibility

`FieldLayerCollection.toCanonical()` emits the `fw-fields-v1` normalized structure. `hash()` is the existing 64-bit FNV-1a canonical hash over that structure. Parameter object construction order, runtime `Map` insertion order, and sparse allocation order cannot alter serialized ordering.

`fixtures/fw-003-golden.json` freezes a representative mixed scalar/vector authoring scenario. Changes to field normalization, brush rasterization, weighted arithmetic, sparse serialization, ordering, or transform/parameter interpretation require an explicit compatibility decision and fixture/documentation update.
