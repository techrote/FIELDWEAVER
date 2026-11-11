# The Unmoored Kite — original composition 05

A single enormous broken kite / suspended diagram, not another array of rain, strata or seedhead rosettes. Four unequal outline edges enclose a deliberate dark void. Thin crossing structural tethers try to keep the rhombus intact; an irregular trailing cable and detached indexing notches register its departure. Later exact-tick interventions pull the scaffold out of registration without redrawing its source silhouette.

This is a newly authored original, **not** an FW-011 mutation. An earlier composition's normalized JSON formatting was consulted only as a schema example; the seed, geometric construction, fields, emitter positions and velocities, LUT values, and score are independently authored.

- Import `recipe.json` through the local workbench's **Load recipe**.
- Seed `0x19c7d2a5` (432525989); no lineage parent.
- Tick **160**; crop **256×192**, centre world (128,112), 0.75 units/pixel.
- **7 ordered fields, 46 emitters, 4 materials, 5 LUTs, 18 interventions**.
- Temporal score: late counter-rotation, quantization on/off, freeze/release, a right/down unmooring drift, and low-corner vortex.
- Colour logic: iron red seam, pale aqua/silver structural filament, ash-gold motes, signal-mauve splinters. Dust radius is age-LUT controlled, not colour-only.
- Canonical meaning belongs exclusively to **FW-012 CPU software raster**, never the WebGL preview.

Reproduce from root using Node 22/24:

```sh
npm ci
npm run verify
node gallery/originals/05-the-unmoored-kite/qualify.mjs --write
```

Write mode generates `the-unmoored-kite.png`, `the-unmoored-kite.provenance.json` and `qualification.json`. Actual export identity and visual merit require an executed render. No engine, editor, gallery manifest or historical art is changed.

## Actual archived FW-012 observation and admission

The Node 24 exact-head canonical raster was recovered losslessly from run 42959559216's original-art regression log, **visually inspected before selection**, and committed as `the-unmoored-kite.png`. Its angular pale-cyan main struts, red crossed lattice, minute gold registers and mauve interruptions retain the intended central fracture, while open black space surrounds the silhouette. The escaping lines at the right are deliberate. This observation concerns actual decoded canonical pixels, not WebGL.

- Recipe identity: `90bd1ed3d7b6dbf5`.
- Actual raw RGBA8 identity: `ded31b12f6efd7dc`.
- State / deposition / result: `5f630c24020ee1ea` / `66d14f1ff1226488` / `81552f777588879c`.
- Canonical ordered depositions: **20451**.
- Fixed crop: **256×192**, 0.75 world units/pixel, world centre (128,112).
- The PNG, full `fw-export-provenance-v1` sidecar and receipt are now checked-in golden artifacts; `composition.test.mjs` compares fresh exact replay against their bytes/identities.

This is a final authored candidate, not artistic admission: Integration may compare it independently with earlier originals and decide whether to accept. The selected visual is intentionally hard-edged and not a generic random texture.
