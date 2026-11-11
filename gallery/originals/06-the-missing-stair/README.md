# The Missing Stair — original composition 06

## Intention

An impossible building section with three **unconnected stair flights**. The largest pale mineral flight rises through the centre of a black plate but deliberately loses two treads. A shorter terracotta counterflight approaches from the east; an ultraviolet shard-flight remains stranded high on the west. The generous void is an authored part of the work. Small pyrite survey marks form discontinuous diagonal indices at the gaps, while five segmented handrail fragments never quite connect.

This is independently authored vector-field geometry, not a mutation or recolouring of any prior FIELDWEAVER work. Every new emitter placement, velocity, onset, field value, material adjustment, LUT and exact-tick score was constructed for this piece. The preceding Kite recipe was consulted **only for versioned serializer key order and schema examples**, never as a parent.

### Exact reproduction

1. Use **Load recipe** on `recipe.json` in the offline local workbench.
2. Seed: `0x4c2e91b7` (1278120375); no lineage parent.
3. Replay to **tick 148**. Canonical framing: **320 × 240**, world centre (160,120), 1 world unit/pixel.
4. Export using **FW-012 CPU canonical PNG** and provenance; do not substitute WebGL preview.

The score starts with chalk-filament treads, rust ink counterparts, then mauve axis-quantized fragments. Vortexes at ticks 34 and 47 pull at the broken junction; the four-sector quantizer switches on only from 63–75; the score holds at 82–88, followed by weak asymmetric drift and a final displaced dust burst. Four material families have different movement/deposition behaviours. Five dedicated LUTs include a non-colour age-dependent dust radius mapping. All 70 emitters, seven field layers, 17 commands, and five LUT assets are versioned in the immutable normalized JSON.

## Evidence boundary

The authored recipe is executable but a locally produced screenshot or WebGL preview is **not** the canonical output. The artwork-specific test uses `createCanonicalExport` (FW-012), two tile partitions, decoded RGBA8 comparison and replay checks. Its initial CI-only evidence channel emits the real PNG and provenance for archival. Until that channel has actually executed and its image is visually inspected, do not claim an observed canonical image or artistic quality.

```sh
npm ci
npm run verify
node gallery/originals/06-the-missing-stair/qualify.mjs --write
```

Only files inside `gallery/originals/06-the-missing-stair/` belong to this submission. Historical works and canonical engine remain immutable.
