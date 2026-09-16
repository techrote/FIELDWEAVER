# Deterministic field operators (`fw-operators-v1`)

FW-004 defines the first canonical field-sampling contract. Operator sampling is DOM/GPU-free and uses only explicit integer/fixed-point inputs. All state-affecting vectors use signed Q16.16 components.

## Registry and layer contract

`FIELD_OPERATOR_REGISTRY` is the machine-readable registry. Every operator layer must be a vector `SparseFieldLayer`, have a supported blend mode, and contain only the validated integer parameters below. Sampling is performed in `FieldLayerCollection.orderedLayers()` order.

Source operators produce a Q16.16 vector which is composed component-wise with the current accumulator. `replace` replaces both components; `add` uses signed-int32 saturation; `min`/`max` select the component-wise signed minimum/maximum. The initial accumulator is `(0, 0)`.

`direction-quantizer` is deliberately a **stack transform**, not an independent source: at its position in layer order it replaces the accumulator with its quantized form. Its stored `blend` value is therefore not consulted during sampling and debug traces report `transform`. This distinction is part of `fw-operators-v1` semantics.

All omitted parameters use the defaults documented below. All numeric parameters are signed 32-bit integers because FW-003 field parameters have that canonical representation.

## Operators

### `uniform`

Global pure source with no hidden state.

- `vectorXQ16`: any signed int32, default `0`.
- `vectorYQ16`: any signed int32, default `0`.

The same vector is returned at every world coordinate.

### `attractor`

Finite point source centred on `layer.transform.origin`.

- `strengthQ16`: any signed Q16.16 int32, default `65536`. Positive values attract; negative values repel.
- `radiusQ16`: positive Q16.16 int32 in `[1, 2147483647]`, default `65536`.

Distance is the Chebyshev metric `max(abs(dx), abs(dy))` in canonical Q16.16 world units. Influence is exactly zero at the centre (direction is undefined), exactly zero on the radius because linear falloff reaches zero there, and exactly zero outside the radius. Inside support, direction is normalized by Chebyshev distance and strength is multiplied by `(radius - distance) / radius`, using the canonical half-away-from-zero Q16 helpers.

### `vortex`

Finite point source with the same support and falloff contract as `attractor`, centred on `layer.transform.origin`.

- `strengthQ16`: any signed Q16.16 int32, default `65536`; sign reverses rotation.
- `radiusQ16`: positive Q16.16 int32 in `[1, 2147483647]`, default `65536`.

The normalized radial direction is rotated 90 degrees before applying falloff. Influence is exactly zero at/on/outside the same bounds described above.

### `turbulence`

Global, stateless, seeded world-space integer noise. It is independent of sampling/call order.

- `seed`: any signed int32; interpreted by the hash mixer as its exact 32-bit pattern. Default `0`.
- `amplitudeQ16`: nonnegative signed int32 Q16.16 in `[0, 2147483647]`, default `65536`.
- `cellSizeQ16`: positive signed int32 Q16.16 which must divide the canonical chunk span (`16777216`) exactly; default `65536`.

The normalized chunk/world coordinate is converted to a global lattice coordinate, then two independently salted 32-bit integer hashes produce X/Y components. No PRNG stream is consumed. A lattice cell therefore samples identically regardless of traversal order, chunk representation, browser frame timing, or unrelated simulation activity.

### `direction-quantizer`

Ordered stack transform.

- `sectors`: exactly `4`, `8`, or `16`; default `8`.

The implementation uses checked-in Q16.16 unit-direction lookup tables. It selects the sector with the largest integer dot product and preserves the input vector's Chebyshev magnitude. Zero remains zero. Ties resolve to the earliest direction in the checked-in table, making boundary behaviour explicit and stable.

## World/chunk semantics

Every sample position and point origin is normalized through the FW-002 world-coordinate contract before evaluation. Point operators compute deltas with BigInt intermediates, then enter int32/Q16 arithmetic only inside their bounded support. Turbulence derives a global integer lattice coordinate from normalized chunk coordinates and local position. Equivalent positions on either side of a chunk seam, including negative-coordinate representations, therefore sample identically.

## Debug and golden interfaces

- `sampleFieldOperator(layer, position, input?)` samples one operator. `input` is used by the quantizer transform.
- `sampleFieldStack(collection, position)` samples the ordered enabled stack.
- `sampleFieldStack(collection, position, { debug: true })` additionally returns per-layer before/sample/after vectors without mutating canonical state.
- `sampleFieldStackHash(collection, positions)` hashes ordered samples with the operator compatibility version.

Golden fixtures live in `fixtures/fw-004-golden.json`; tests cover each operator, finite support, composition order, chunk seams, negative coordinates, seeded call-order-independent noise, debug traces, and stack hashes.
