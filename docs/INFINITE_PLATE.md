# Infinite Plate deterministic regional evaluation

FW-013 defines the first canonical Infinite Plate contract. The user may navigate an effectively unbounded chunk-addressed plane, but the camera never selects or mutates simulation truth. A canonical request is an explicit recipe, target tick, finite crop, agent/deposition capacity contract, and versioned evaluator identity.

## Reference evaluation method

`fw-infinite-plate-v1` uses `full-replay-reference-v1` as its correctness oracle. The current FIELDWEAVER recipe model has finite explicit emitters, fixed-step agents, sparse fields, and no hidden spatial state. Replaying the complete normalized recipe from tick zero to the requested tick is therefore a conservative evaluation of every cause that can reach any crop. This deliberately avoids an unsafe optimization where simulating only nearby emitters could change stable agent allocation, capacity contention, deposition sequence, or command effects.

Regional chunking happens after that deterministic replay. Only deposition records whose geometry overlaps requested crop chunks are retained in the regional memoization cache. Their original global deposition sequence IDs are preserved and deduplicated before FW-012 software rasterization. A future causal-pruning implementation may replace the reference replay only after adversarial tests prove byte/hash equivalence to this oracle.

## Causal support contract

The evaluator publishes a conservative causal halo:

`targetTick * MAX_STEP_DISPLACEMENT_Q16 + maxFiniteFieldSupportQ16 + MAX_MATERIAL_INTERACTION_RADIUS_Q16`

Attractor and vortex radii contribute finite field support. Painted sparse cells are local data. `uniform` and `turbulence` are allowed global sources because they are pure deterministic functions of recipe/world coordinates and contain no neighboring mutable state. `direction-quantizer` is a local stack transform. Unknown global/stateful operators are rejected until their causal contract is explicit.

The reference replay is intentionally stronger than the halo: it evaluates the whole finite recipe state, so every contributor is included even when capacity allocation creates non-spatial coupling.

## Chunk identity and cache semantics

Requested chunks are derived only from the explicit crop's chunk-aware world coordinates. Cache keys include the Infinite Plate version/method, simulation version, recipe hash/schema/engine version, target tick, agent capacity, deposition capacity, and chunk coordinate. Camera position, request order, cache size, eviction history, tile dimensions, wall-clock timing, and browser/GPU state are excluded.

`PlateChunkCache` is bounded LRU-style memoization. Eviction changes only performance. A partial miss falls back to the full reference replay and republishes requested chunk entries. Cache hits are validated against their semantic prefix and source replay hashes before use.

## Canonical regional identities

Each evaluated crop exposes:

- source canonical state/deposition/result hashes from the complete reference replay;
- an explicit domain hash over recipe/tick semantics, crop, requested chunks, and causal halo;
- a regional deposition hash over the ordered records available to the crop chunks;
- a regional result hash binding domain, source state, regional deposition hash, and raw pixel hash;
- the FW-012 `rawRgbaHash` over decoded row-major RGBA8 bytes.

For the same recipe, seed, tick, crop, and simulation capacity contract, these identities must be invariant under camera path, request order, cache capacity, eviction, and raster tile shape.

## Navigation and framing

`InfinitePlateViewSession` is deliberately separate from recipe/evaluator state. The browser preview may pan and zoom across stable chunk coordinates without mutating recipe identity. The Infinite Plate panel's **Frame current view** operation copies the current camera center and scale into an explicit crop; it does not rebase world coordinates or add canonical commands. The same framing is synchronized to the FW-012 export controls.

Evaluating a selected crop can temporarily preview its regional deposition records through the existing read-only WebGL renderer. This is presentation only. Returning to the live editor preview does not change canonical state.

## Foreground work, cancellation, and safeguards

There is no timing-dependent background simulator. `evaluateAsync()` performs the same fixed-step reference replay in deterministic tick batches, yields to the browser only between batches, and accepts an `AbortSignal`. Cancellation occurs before a result is published and never changes recipe truth. `prefetchAsync()` is serial foreground work built from the same interruptible primitive; completion order cannot affect canonical output.

Interactive evaluation bounds requested chunk count, assembled raster pixels, and an estimated `targetTick * agentCapacity` work budget. Deposition capacity remains explicit and fails rather than truncating canonical truth. Large image workflows continue to use the FW-012 tiled raster path rather than allocating an unbounded plate.

## FW-012 export integration

`createInfinitePlateExport()` packages an evaluated finite crop with the established `fw-canonical-export-v1`, `fw-canonical-raster-v1`, `fw-export-provenance-v1`, and `fw-png-rgba8-v1` components. Provenance adds an `infinitePlate` record containing evaluator/method version, domain hash, causal halo, regional hashes, requested chunk count, and source/regional deposition counts. The canonical image oracle remains the decoded RGBA8 byte buffer, not PNG bytes or WebGL output.
