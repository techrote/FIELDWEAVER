# The Zero Meridian — original composition 07

An invented compass with no valid north: a broken porcelain outer ring, a displaced copper inner register, a severed surveying needle and small brass calibrations scattered outside the operative geometry. The dial's deliberately missing degrees remain vacant, despite the materials' short attempts to repair the arc. The choice is **mechanical geometry and refusal of completion**, neither the botanical vortices of 04, the kite silhouette of 05 nor the isolated stair flights of 06.

This is an independent, authored FIELDWEAVER score, not a mutation or resampling of any other artwork. The local \`author.mjs\` defines every vector layer, emitter, material, LUT and command. A fixed integer seed is the only stochastic input. No external assets or network are required.

- Seed: \`0x5ce73a19\`; no parent lineage.
- Target tick: **154**, with an earlier replay comparison at tick 69.
- Framing: **352×288**, world centre **(128,124)**, **0.625 units/pixel**.
- Seven ordered fields (uniform, turbulence, multiple vortices, quantizer); four distinct materials; five custom LUT assets (colour and fleck diameter); sixteen explicit timed interventions.
- The timed score briefly deflects the ring with vortices, discretizes direction, freezes and resumes, pulls the scaffold off its bearing and releases a late batch of calibration marks.
- Exact canonical output uses FW-012 CPU software export, **not** a WebGL proxy. The committed 352×288 PNG was decoded and visually inspected after exact-source Node 24 replay.

## Reproduce

From the repository root:

\`\`\`sh
npm ci
npm run verify
node gallery/originals/07-the-zero-meridian/qualify.mjs --write
\`\`\`

Then import \`recipe.json\` through the local workbench. \`--write\` generates an exact normalized recipe, canonical \`the-zero-meridian.png\`, \`fw-export-provenance-v1\` sidecar and replay receipt. All four committed artifacts are independently re-created, byte-compared and pinned by the regression on every Node 22/24 run. Visual inspection confirms the intended interrupted cyan outer arc, rust inner arc, diagonal surveying needle, violet misregistration ticks and widely spaced brass dots; it is a deliberately **sparse, fine-line composition**, not a dense textured plate.

Owner/Integration is responsible for independent aesthetic acceptance. No earlier works or shared source are modified.

## Observed canonical identity

| Field | Verified CPU result |
|---|---|
| Recipe | `002a783e5492a7d5` |
| Raw decoded RGBA8 | `20d0367ebe3a8d8e` |
| State / deposition / result | `392c1dc87f4f73df` / `6d062421d2acc4e2` / `9f3193bbf43aa545` |
| Emitters / ordered depositions | 100 / 9,630 |
| Non-background pixels | 3,041 |
| Native evidence origin | GitHub Actions Node 24 run `42964828290`, losslessly transferred without a graphics proxy |

The observed image has an intentionally thin visual weight; its spare technical-drawing register should be assessed against the rest of the anthology before admission. This is the **actual software-export image**, not inferred from the score alone.
