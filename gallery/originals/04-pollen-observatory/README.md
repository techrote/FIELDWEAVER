# The Pollen Observatory — five unstable constellations

**FIELDWEAVER original 04; original-authored recipe, not a mutation.** An installation of five displaced seedheads, arranged as a broken constellation rather than a horizontal or vertical register. The actual FW-012 canonical software-raster PNG is checked in and compared byte-for-byte against fresh replay in its automatically discovered test.

## Composition

Five centres at world (45,66), (127,62), (210,86), (77,156), and (184,164) have intentionally nonuniform size, phase and petal ordering. Six filament emitters per centre define oblique radial spokes, each at its own onset and velocity; five fine ink hearts supply compact anchors, five offset dust emitters scatter spores, and five delayed shard emitters put crisp cuts through the last movement. There are **45 emitter definitions** across four behaviourally different materials; this is not an RGB flicker over a reused scene.

Nine ordered fields establish a restrained early eight-sector lock, slow global draft, mild turbulence, and **five independently gated spatially bounded vortices**. Twenty-three explicitly ordered interventions progressively release the lock, gate each vortex, silence/recover one emitter, introduce an exactly frozen interval at ticks 91–96, begin the late shear, and reinstate quantization before the final fracture. Five independent versioned LUTs control chalk/pale-shell ink, iron-red-to-saffron filament, lichen spores, iris-purple shards, and age-varying dust steering. The deliberately blank intervals between the five heads are part of the composition.

## Reproduction and status

- Schema: `fw-recipe-v1` / `fw-agents-v1`; root seed **0x6cf49b12**; no lineage parent.
- Target **tick 176**, crop **576×384** with centre world **(128,120)** at **0.5 units/pixel**.
- Native software raster: FW-012 with 4096-agent and 250000-deposition bounds.
- Run `npm run verify` or `node gallery/originals/04-pollen-observatory/qualify.mjs --write`; `--write` stores native working copies in `rendered/`.
- The regression test verifies normalized recipe import/export, explicit-tick replay, two dissimilar raster tile partitions, PNG decode/raw RGBA identity, midpoint roundtrip, pinned state/deposition/result/pixel identities, and byte-identical archived PNG, versioned provenance and qualification receipt.

**Artwork remains Draft:** the integration curator must independently inspect the eventual real FW-012 image and assess it against Nocturne, Luminous Ledger and Interval Engine before acceptance. No prior work or shared engine/editor/preset/manifest is modified.

## Actual canonical result and visual reading

The 576×384, tick-176 PNG was rendered by the repository's FW-012 Node 24 CPU implementation (GitHub Actions [#42952369612](https://github.com/techrote/FIELDWEAVER/actions/runs/42952369612)), decoded and inspected before the archival commit. **Five separate spiral/seedhead apparitions are visible**, not identical circles: the upper-left and lower-centre forms are the densest, the upper-right turns into a more open ochre fan, the lower-left is a broken red basin and the lower-right a compact notched vermilion shell. Thin mint and iris accents cut across the dominant burnt-orange and shell-pink loops. Most of the 576×384 surface stays black, especially the hollow centre between the five figures; the work is intentionally more object-like and sparse than the prior horizontal/vertical register pieces. This interpretation is an actual visual observation of the canonical PNG, not a browser WebGL proxy.

| Pinned canonical contract | Identity |
|---|---|
| Recipe | `5cdf27d4b0c2e205` |
| Raw decoded RGBA8 | `194610dd7ca77ca1` |
| State | `a44142e5fcb73df5` |
| Deposition | `62e03786c103dee8` |
| Result | `4e7ef6ed0d5a6bcd` |
| Depositions | **185,004** of the 250,000 bounded allowance |

The file `pollen-observatory.png` is the actual canonical CPU PNG; `pollen-observatory.provenance.json` is the exact versioned `fw-export-provenance-v1` sidecar; `qualification.json` is an independent artwork-specific replay receipt. Presentation resizing is noncanonical. The visual composition and admission remain subject to independent Integration judgement.
