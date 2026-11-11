# The Zero Meridian — original composition 07

An invented compass with no valid north: a broken porcelain outer ring, a displaced copper inner register, a severed surveying needle and small brass calibrations scattered outside the operative geometry. The dial's deliberately missing degrees remain vacant, despite the materials' short attempts to repair the arc. The choice is **mechanical geometry and refusal of completion**, neither the botanical vortices of 04, the kite silhouette of 05 nor the isolated stair flights of 06.

This is an independent, authored FIELDWEAVER score, not a mutation or resampling of any other artwork. The local \`author.mjs\` defines every vector layer, emitter, material, LUT and command. A fixed integer seed is the only stochastic input. No external assets or network are required.

- Seed: \`0x5ce73a19\`; no parent lineage.
- Target tick: **154**, with an earlier replay comparison at tick 69.
- Framing: **352×288**, world centre **(128,124)**, **0.625 units/pixel**.
- Seven ordered fields (uniform, turbulence, multiple vortices, quantizer); four distinct materials; five custom LUT assets (colour and fleck diameter); sixteen explicit timed interventions.
- The timed score briefly deflects the ring with vortices, discretizes direction, freezes and resumes, pulls the scaffold off its bearing and releases a late batch of calibration marks.
- Exact canonical output must be obtained from FW-012 CPU software export, **not** the WebGL preview. Apparent geometry is *intended* until the actual exported image has been inspected.

## Reproduce

From the repository root:

\`\`\`sh
npm ci
npm run verify
node gallery/originals/07-the-zero-meridian/qualify.mjs --write
\`\`\`

Then import \`recipe.json\` through the local workbench. \`--write\` generates an exact normalized recipe, canonical \`the-zero-meridian.png\`, \`fw-export-provenance-v1\` sidecar and replay receipt. After committing the native outputs, regression checks must compare all archived bytes and hashes against fresh replay; this initial candidate deliberately does not invent identities or claim visual acceptance.

Owner/Integration is responsible for independent aesthetic acceptance. No earlier works or shared source are modified.
