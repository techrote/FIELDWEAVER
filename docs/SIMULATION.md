# FW-005 canonical agent simulation

`fw-agents-v1` defines the first canonical generative simulation contract. The module is DOM/GPU-free and consumes only explicit recipe-like material, emitter, field, seed, capacity, and tick inputs.

## Agent storage and ordering

Active agents live in fixed-capacity structure-of-arrays typed storage. Numeric IDs are the 1-based slot IDs. Allocation always scans from ID 1 upward and takes the lowest free ID; therefore reuse after death is explicit and deterministic. Updates always traverse active IDs in ascending numeric order. Capacity exhaustion never reallocates or depends on frame rate: spawn attempts continue in canonical emitter/spawn order and are counted as deterministic dropped spawns.

## Tick phase order

For canonical tick `N`:

1. emitters are visited in ascending emitter ID;
2. each emitter computes its scheduled rate plus an optional tick-specific burst;
3. spawn attempts are processed in spawn order using only that emitter's private seeded PRNG stream;
4. active agents are updated in ascending agent ID;
5. the current ordered field stack is sampled at each pre-move world position;
6. material steering/inertia computes a bounded velocity;
7. the position is normalized across chunk boundaries;
8. a canonical deposition record is emitted when required by that material;
9. age increments and agents reaching lifetime are released;
10. the simulation tick increments.

New agents therefore participate in the same tick in which they spawn. IDs released during update are not available to spawning until the following tick because all spawning precedes all updates.

## Canonical movement bounds

- `MAX_SPEED_Q16 = 4.0` world units/tick in signed Q16.16.
- Each velocity component is clamped to `[-MAX_SPEED_Q16, +MAX_SPEED_Q16]` after material steering.
- Consequently the Chebyshev step displacement bound is exactly `MAX_STEP_DISPLACEMENT_Q16 = 4.0` world units/tick.
- The largest baseline deposition/interaction radius is `MAX_MATERIAL_INTERACTION_RADIUS_Q16 = 0.5` world units.

These bounds are compatibility-relevant inputs to later finite-causality/Infinite Plate work.

## Baseline materials

All state-affecting arithmetic uses integer/fixed-point helpers from `fw-canonical-v1`.

| Kind | Inertia | Field steering | Lifetime | Deposit cadence | Primitive | Radius | Distinct behaviour |
|---|---:|---:|---:|---:|---|---:|---|
| Ink | 3/4 | 1/2 | 96 ticks | every tick | disc | 1/2 | balanced advection with continuous broad deposition |
| Filament | 7/8 | 1/4 | 160 ticks | every tick | segment | 1/4 | strong directional persistence and long connected trails |
| Dust | 1/4 | 3/4 | 48 ticks | every 2 ticks | point | 1/8 | low inertia, field-responsive sparse particles |
| Shard | 1/2 | 1/1 | 72 ticks | every tick | segment | ~1/6 | post-steering velocity snaps to the dominant world axis, producing abrupt angular travel |

Material parameters are explicit integers and may be overridden within validated bounds. Baseline material IDs are Ink=1, Filament=2, Dust=3, Shard=4.

## Emitters and independent randomness

Emitters use stable unsigned IDs and are evaluated in ID order. Each emitter owns an independent `xoshiro128**` stream seeded as `fromSeed(rootSeed, emitter.id)`. Adding another emitter therefore cannot perturb an existing emitter through shared PRNG call counts. Capacity competition can still affect which spawn attempts are admitted; that is an explicit deterministic resource rule, not PRNG coupling.

Schedules provide `startTick`, optional `stopTick`, `intervalTicks`, a regular `rate`, and unique tick-specific `bursts`. Supported placement geometries are:

- `point`: fixed canonical world origin;
- `box`: integer-Q16 offset sampled inside explicit width/height bounds;
- `mask`: deterministic selection from an explicit ordered list of Q16 world offsets.

Base velocity and bounded integer velocity jitter are applied per spawn.

## Deposition event stream

Every canonical deposition record contains tick, stable sequence, agent/material identity, material kind, primitive type, normalized pre/post world positions, Q16 radius, and Q16 strength. Records are sufficient for a later renderer/software rasterizer without reading framebuffer/GPU state.

Deposition retention is explicit. `maxDepositions` is a constructor input; exhausting it raises a deterministic error rather than silently discarding canonical provenance. Future bounded-memory replay/export strategies may replace retention only through a versioned contract.

## Hashing and diagnostics

`stateHash()` hashes tick, spawn/drop counters, active SoA state, and each emitter's private PRNG/runtime state. `depositionHash()` hashes the ordered deposition stream. `resultHash()` combines both. Timing measurements are deliberately excluded from every canonical hash.

`scripts/benchmark-sim.mjs` is a headless diagnostic harness. Wall-clock timing is observational only and never a correctness oracle or input to simulation state.
