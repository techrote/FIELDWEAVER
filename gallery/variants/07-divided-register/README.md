# Divided Register — candidate evolutionary atlas

A FW-011 two-generation search from the **accepted, immutable First Weave** preset. This investigation asks whether a dense converging register can be split into multiple independent spatial gestures without merely recolouring the parent's marks.

The artwork is currently at its **canonical qualification/curation gate**. Only renderer-derived images qualify as visual evidence. The deterministic test at `atlas.test.mjs` enumerates 20 mutation descendants, replays all at the same exact integer tick/crop, removes degenerate forms and near-identical silhouettes, and produces a six-panel FW-012 CPU contact sheet. The first panel is the immutable parent, subsequent panels are ranked finalists. Its highest-scoring member is *provisional*, not a human-accepted artistic selection.

## Reproduce

- Parent: `first-weave`; recipe hash `bb1a24bc2c9cf0bc`.
- Bridge mutation seed `0x7b1db29c`; child mutation seed `0x52a41c6e`.
- Sibling indices: 0–19; configs specified by `bridgeConfig` and `childConfig` and archived in `atlas.manifest.json` after qualification.
- Exact tick: **172**; early reference tick **42**.
- Crop: **192×144**, centre (142,126) in chunk (0,0), **0.75** world units per pixel.
- Capacity: 4096 agents, 250000 depositions, FW-012 CPU tiles 31×23; same-tick independent 37×29 tile replay.
- Output: loadable `selected.recipe.json`, intermediate `selected-bridge.recipe.json`, canonical `selected.png` and `selected.provenance.json`, parent and finalist canonical PNGs, and noncanonical presentation-only `atlas.png`.

Run `npm run verify` and `node --test gallery/variants/07-divided-register/atlas.test.mjs`. The test generates an exact archive when no evidence exists; after evidence admission it regenerates and byte-compares every archived item. There is no WebGL proxy or fabricated preview. Do not accept or merge until the actual contact sheet has been inspected and the selected specimen's aesthetic rationale recorded.

Only this independent `gallery/variants/07-divided-register/` subtree is owned by the variant worker. Existing artworks, accepted presets, UI and engine remain unchanged.
