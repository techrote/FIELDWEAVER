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

## Evidence and reproduction

The canonical export is FW-012 CPU software raster; WebGL must not be treated as an identity oracle.

```sh
npm ci
npm run verify
node gallery/originals/06-the-missing-stair/qualify.mjs --write
```

No historical or core files are touched.

## Archived and inspected canonical artwork

The true FW-012 Node 24 canonical PNG was recovered **losslessly** from [exact-head Windows-independent CI run 42961094186](https://github.com/techrote/FIELDWEAVER/actions/runs/42961094186), decoded and inspected. Observed: very fine mint stair/riser fragments descend diagonally from the upper-left into a broad dark void; a separate oxide counterflight occupies the upper-right, with small violet cuts and gold registration dots. Several deliberately missing treads remain legible. This is quiet, fine-lined architectural notation rather than a dense poster. The sparse visual weight should be independently considered during artistic admission; no screenshot or WebGL result was substituted.

- Canonical PNG: `the-missing-stair.png` (320×240)
- Recipe identity: `e135011898223cc7`
- Raw RGBA8 identity: `b8c3e7fb1e6aad10`
- State / deposition / result identities: `3455185e94421e62` / `0f6fee0f0e0689ed` / `05966b4b7c3cb6bd`
- Ordered canonical depositions: **25148**
- Provenance: `the-missing-stair.provenance.json` (`fw-export-provenance-v1`)
- Archived receipt: `qualification.json`

The regression now compares fresh replay against the committed PNG bytes, exact decoded RGBA, provenance and the fixed identities on both supported Node versions. It also exercises alternate tile partitions and a same-tick normalized recipe roundtrip.
