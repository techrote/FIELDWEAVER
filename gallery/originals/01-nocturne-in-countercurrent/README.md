# Nocturne in Countercurrent

**Original FIELDWEAVER composition, 11 November 2026.** A study in bilateral circulation: a warm, sediment-bearing flow enters from the upper left; two cool filament ribbons enter from opposite edges; sparse suspended dust descends over them; vertical violet shards cut across the lower register. Two opposite-sign vortices, a central attractor and a temporary sixteen-direction quantizer create a score that changes from curved trajectories to crystalline interruptions and back.

This is an **authored executable recipe**, not a claim that the finished picture has been inspected. Rendered image and canonical export identities remain **unverified until the Node software raster actually runs**. There is no ImageGen stand-in, fabricated contact sheet, WebGL screenshot used as a canonical oracle, or third-party source image.

## Work identity and delivery

| Property | Value |
|---|---|
| Source | Native procedural FIELDWEAVER materials/fields/emitters; no external bitmap |
| Recipe | [`recipe.json`](./recipe.json) |
| Recipe/schema | `fw-recipe-v1` / `fw-agents-v1` |
| Root seed | `0x77d5e2a1` (2010505889) |
| Authored recipe hash candidate | `ee1696765f96ef0c` — independently calculated from current canonical serialization; must be confirmed by the runtime |
| Fields | Six: uniform, two counterrotating vortices, central attractor, turbulence, gated direction quantization |
| Materials/emitters | Ink, filament, dust, shard; six deterministic emitters with different geometries and schedules |
| LUT logic | Five authored assets, four material-specific RGBA ramps, dust steering and filament deposition-strength mappings |
| Timeline | Thirteen explicit ordered commands, including releases, rate change, material change, toggles and a four-tick freeze |
| Target tick | **156** |
| Framing | **512 × 320** RGBA8, centre (160,128), **0.625 world units/pixel** (`40960` Q16.16) |
| Renderer | FW-012 canonical CPU/software raster and provenance |

The intended image is asymmetric rather than a symmetric infinity loop. Emission starts at different heights and times; the right vortex reverses the left vortex's circulation. The cool horizontal strands should cross warm broad deposits without filling the centre uniformly, while descending dust and rising angular shards deliberately leave quieter regions between dense crossings. This is a compositional hypothesis awaiting actual visual qualification.

## Temporal structure

| Tick | Intervention | Intended formal effect |
|---|---|---|
| 0–27 | Opposed filament entrances; ink and dust begin; bursts at 24/27 | Separate directional families establish the horizontal weave |
| 38–58 | First ink emitter stops; dust burst at 48; shard steering changes at 58 | A denser central deposit and sharper lower-register cuts |
| 72–83 | Enable 16-sector quantization; freeze at 79, resume at 83 | Angular interval and retained rest before motion resumes |
| 94–118 | Disable the right vortex; accelerate shard emission; remove quantizer | A temporary opening in the right-hand circulation |
| 122–156 | Late ink burst; restore right vortex at 131 | A final rejoining of asymmetrical currents |

## Reproduce and verify

On Node.js 22 or 24, from repository root:

```sh
npm ci
npm run verify
node gallery/originals/01-nocturne-in-countercurrent/qualify.mjs --write
```

The qualification script imports the **actual repository renderer and recipe replay**, not a replacement implementation. It validates normalized recipe round-trip and expected recipe hash, runs to tick 156, independently exports with two awkward tile shapes, compares state/deposition/result/raw-RGBA identities, decodes the output PNG and verifies exact pixel equality. The `composition.test.mjs` file is discoverable by the repository's `node --test` command. Without `--write`, qualification performs validation only.

Successful `--write` produces:

- `rendered/nocturne-in-countercurrent.png` — genuine canonical PNG;
- `rendered/nocturne-in-countercurrent.provenance.json` — FW-012 export sidecar with actual canonical hashes;
- `rendered/qualification.json` — concise evidence receipt.

These outputs are **not yet present or asserted to exist** in this PR. The original producer environment cannot currently fetch the repository into a local Node runtime, so no canonical export or visual inspection was performed before submission. Integration should run the command on an exact-head CI or local clone, examine the PNG at native resolution, check that the structure differs materially from the built-in presets and sibling artwork, and attach/accept the canonical image and identity receipt. Keep this PR Draft until that visual and provenance gate passes.

Ownership: all proposed files remain under this artwork's own directory. No shared engine, UI, catalog, preset, test-suite infrastructure or historical artwork is modified.
