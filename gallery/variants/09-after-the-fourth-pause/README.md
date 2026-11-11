# After the Fourth Pause — FIELDWEAVER mutation study 09

A bounded visual experiment in **broken time** using the accepted `timeline-pulse` preset as an immutable parent. Six pre-existing authored interventions, including freeze at tick 24 and resumption at tick 28, continue to execute in their authoritative order. New family members vary spatial field and material/seed relationships; they do not rewrite the parent's commands or existing art.

## Artistic problem

Can the pause inside a periodic score become spatially legible as interruption, overlap and persistence? The intended departure from variant 08's sheared, sparse diagonal is a counterpoint of several competing marks from the timeline-rich parent, with differing field responses in the same frame. **This is an intended premise, not a claimed observation of unseen image outputs.**

## Exact deterministic run

From repository root on Node 22/24:

```sh
node gallery/variants/09-after-the-fourth-pause/build.mjs
npm run verify
```

- Accepted parent: `timeline-pulse`; the parent recipe hash is archived in `manifest.json`.
- Generation 1: explicit mutation seed `0x27c9ed14`, FW-011 `all` scope, `bold`, 6 operations, indices 0–15.
- Generation 2: seed `0x4a1f8307`, `fields` scope, `bold`, 1 operation, same sibling index.
- Canonical FW-012 replay: tick **124**, crop **256 × 192**, centre **(126,128)**, **0.75 world units per pixel**, 4096-agent and 250000-deposition hard bounds.
- Topology-sensitive selection: exact RGBA hashes for all 16 children, occupancy-mask symmetric difference against the parent, spatial-bin spread and pairwise mask difference of all 4 finalists. Mere colour replacements cannot pass spatial qualification.
- Direct FW-012 `selected.png`, `parent.png` and finalist PNGs accompany the loadable normalized `selected.recipe.json` and authoritative `selected.provenance.json`.
- The contact sheet only arranges actual canonical pixels for inspection; it is labelled **noncanonical presentation** and never used as a pixel-equivalence oracle.

The Node test generates and compares archive bytes and independently verifies the selected child's normalized recipe roundtrip, lineage parent hash, state/deposition/result identity, alternative tile geometry and decoded PNG RGBA8 identity.

**Acceptance:** The selected variant must be judged on genuine rendered candidate imagery, not numerical ranking alone. The browser import and final aesthetic admission belong to Integration. No historical source, shared core, catalog, other worker lane or prior gallery assets are altered.
