# Canonical simulation contract — FW-002

This document freezes the first FIELDWEAVER canonical-state compatibility contract. Code that changes any rule below must deliberately change the canonical engine compatibility version and update golden fixtures rather than silently reinterpreting existing state.

## Numeric formats

Canonical hot state uses explicit 32-bit integer storage. Signed quantities use two's-complement `int32` range `[-2147483648, 2147483647]`; IDs, seeds, tick counters and unsigned quantities use `uint32` range `[0, 4294967295]`.

Positions, velocities and other fractional canonical quantities introduced at this layer use signed **Q16.16** fixed point: one logical unit is `65536`. Integer/fixed-point helpers validate their inputs. Addition/subtraction and fixed-point multiply/divide saturate to the signed 32-bit range rather than wrapping. Fixed-point multiplication and division use exact integer intermediates and **round to nearest, with exact half ties away from zero**. Conversion from Q16.16 to an integer truncates toward zero. Division by zero is an error.

Canonical state transitions must not use `Math.random()`, frame time, wall-clock time, DOM state, GPU state or ordinary floating-point arithmetic as semantic input. JavaScript `BigInt` is used internally where an exact intermediate would exceed the integer precision of a JavaScript Number; persisted hot state remains 32-bit typed/integer data.

## World coordinates

A logical position is `(chunkX, chunkY, localX, localY)`:

- `chunkX`, `chunkY`: signed 32-bit chunk coordinates;
- `localX`, `localY`: signed Q16.16 input values which normalize into `[0, CHUNK_SPAN_Q16)`;
- one chunk is **256 logical cells**, so `CHUNK_SPAN_Q16 = 256 * 65536 = 16777216`.

Normalization uses mathematical floor semantics. For example local `-1` becomes the previous chunk with local `16777215`. Crossing either positive or negative boundaries therefore has one exact representation. Chunk overflow is an error; it never silently wraps.

Canonical coordinate ordering, where a total order is needed, is `(chunkY, chunkX, localY, localX)` ascending.

## PRNG and deterministic substreams

The canonical PRNG at this layer is **xoshiro128\*\*** with four uint32 state words. Seed expansion and stable substream derivation use the checked `mix32`/`deriveSeed` functions in `src/core/prng.js`. Stable stream seeds derive from the explicit root seed plus stable uint32 identity/domain parts; they never depend on how many random draws an unrelated feature happened to make.

The checked FW-002 vector for root seed `0x12345678` and stream ID `0x42` begins:

```text
1157361581, 1849995165, 947661637, 1672453563, 3575711744,
4109442462, 1740981171, 435890908, 15586571, 2797456083
```

Changing this sequence is a canonical compatibility change.

## Tick semantics and speed control

Canonical time is a uint32 tick counter. State at tick `N` is the fully committed state after exactly `N` transitions from reset. One step consumes state at tick `N`, runs the deterministic tick handler once, then commits tick `N+1`. Tick overflow is an explicit error.

Run/pause and speed are scheduling controls, not simulation parameters. `FixedStepController` represents speed as a reduced positive integer ratio and uses an integer remainder accumulator to decide how many canonical ticks to request. Pause requests zero ticks. Single-step always requests exactly one tick. Multi-step requests exactly the caller-specified integer count. Reset restores tick zero, the seed-derived PRNG state and all declared initial table rows; controller reset also pauses and clears scheduler remainder.

Therefore two executions that reach the same tick through different speed schedules must have identical canonical state, assuming the same recipe/state inputs and command sequence.

## Stable IDs, ordering and SoA storage

`CanonicalSoATable` is the baseline structure-of-arrays container. Column storage uses `Int32Array` or `Uint32Array`. Stable ID `0` is reserved; IDs begin at `1`, increase monotonically and are not reused by FW-002. Iteration that can affect canonical results is ascending stable-ID order. Schema column names are normalized lexicographically rather than depending on object construction order.

The kernel sorts named canonical tables by deterministic code-unit string comparison. Future subsystems that introduce deletion/reuse or richer ordering must specify those semantics explicitly before changing this contract.

## Serialization and hashes

`canonicalStringify` accepts canonical plain objects, arrays, strings, booleans, null, safe integers and typed arrays. Object keys are sorted lexicographically; array order is preserved; unsupported/non-integer values fail loudly. Typed arrays serialize with an explicit constructor type and integer values.

Canonical state hashes are 64-bit FNV-1a over UTF-8 canonical serialization, emitted as 16 lowercase hexadecimal digits. This hash is a deterministic regression/provenance identifier, not a cryptographic authenticity primitive.

The FW-002 golden fixture in `fixtures/fw-002-golden.json` exercises the kernel for 1000 ticks, verifies repeatability, and verifies reset back to the exact initial hash.

## Compatibility version

The initial compatibility identifier is:

```text
fw-canonical-v1
```

Changing numeric formats, rounding, PRNG sequence/seeding, coordinate normalization, tick meaning, state ordering, serialization or hash semantics requires an explicit compatibility decision and corresponding fixtures/documentation update.
