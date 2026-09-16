# Deterministic LUT assets and mappings (`fw-lut-v1`)

FW-008 makes lookup tables first-class recipe assets rather than renderer-only palettes. A LUT may supply preview colour, canonical material parameters, or both. Canonical behaviour never samples browser/GPU textures: simulation code indexes validated integer LUT data directly.

## Asset format

A LUT asset has:

- `schemaVersion: "fw-lut-v1"`;
- a nonzero stable unsigned 32-bit `id`;
- a human-readable `name`;
- `size` in the supported range 2–4096 entries (256 and 512 are built-in/practical sizes);
- one or more named channels, each containing exactly `size` unsigned 16-bit integers in `[0, 65535]`.

Channel names are explicit. Colour LUTs conventionally expose `r`, `g`, `b`, and optionally `a`; behaviour LUTs may use channels such as `logic`. Assets serialize to normalized JSON and contribute a deterministic canonical hash. Import rejects malformed JSON, unsupported schema versions, duplicate IDs, wrong channel lengths, and out-of-range samples.

## Mapping format

Mappings use `fw-lut-map-v1` and identify a material, LUT, source quantity, channel, address mode, integer transform, and destination. Only one mapping for a given `(materialId, destination)` is allowed.

Supported source quantities are:

- `constant`;
- `ageTicks`;
- `lifetimeProgressQ16` (`0..65536`);
- `speedMagnitudeQ16` (Chebyshev component magnitude);
- `agentId`;
- `emitterId`;
- `spawnOrdinal`.

Supported destinations are:

- `color`;
- `lifetimeMultiplierQ16`;
- `steeringMultiplierQ16`;
- `depositionStrengthQ16`;
- `radiusQ16` (also the canonical width/radius source for later software export).

## Indexing and address modes

A mapping declares inclusive integer `inputMin` and `inputMax`.

For **clamp**, the source is first clamped into that range. For **wrap**, it is reduced modulo the inclusive period `inputMax - inputMin + 1`, with negative inputs normalized to a positive modulus.

The index is then:

```text
floor((value - inputMin) * (size - 1) / (inputMax - inputMin))
```

If `inputMin == inputMax`, index 0 is selected. No floating-point normalization participates in canonical sampling.

## Integer scale, bias, and bounds

A sampled 16-bit value is transformed as:

```text
round_half_away_from_zero(sample * scaleNumerator / scaleDenominator) + bias
```

and then clamped to the mapping's explicit `outputMin..outputMax` interval. The denominator must be positive. Multipliers may not produce negative values. Colour mappings are constrained to `0..65535` before deterministic conversion to 8-bit RGBA.

Invalid mappings fail during validation or, when a destination has a stricter simulation bound, when that value would enter canonical state. There is no silent wraparound or hidden floating-point reinterpretation.

## Canonical application points

The simulation applies LUT logic at explicit deterministic points:

- lifetime multiplier: once at spawn, before the agent lifetime is stored;
- steering multiplier: each agent update, before field steering is integrated;
- deposition strength/radius: when the canonical deposition record is emitted;
- colour: when the deposition record is emitted as optional `colorRgba8`.

Mapped radius remains constrained by the canonical material interaction-radius bound. Mapped deposition strength and steering multipliers remain bounded nonnegative signed-32-bit values.

Colour is deliberately **non-dynamical**. Changing only a colour LUT changes deposition colour/provenance and the deposition/result hash, but does not consume PRNG values, change agent velocity/lifetime, or alter emitter substreams. Tests lock this separation down.

## Built-in examples

The editor starts with deterministic generated examples:

- `Spectrum 256`: RGBA + rising `logic` channel, used by Ink colour;
- `Pulse 512`: RGBA + triangular `logic` channel, used by Dust steering.

Generation is deterministic integer arithmetic. The editor can also create fresh 256/512 generated assets, edit individual 16-bit channel entries, assign or replace material mappings, remove mappings, and import/export normalized JSON.

## Editor semantics

LUT assets and mappings are model state and contribute to the editor authoring identity. LUT edits pause/reset the current simulation in FW-008, consistent with other pre-timeline authoring changes. FW-009 will persist these assets/mappings as part of the versioned recipe and provide explicit command-timeline semantics for simulation-time mapping changes.

All LUT controls are native labelled controls in the existing FW-007 sidebar, so asset selection, entry editing, mapping assignment and JSON import/export remain keyboard reachable.
