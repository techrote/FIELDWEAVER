# Offworld Fold — The Unspooling Relay

A mutation atlas from the accepted Infinite Lineage far-world preset. A small false-colour knot at the left unspools into multiple bright cyan trails: a horizontal electronic skein balanced by a substantial dark plate. A rare expansive register amid a family of sparsely branched signals.

The parent is the shipped immutable `infinite-lineage` recipe; no pending original or variant art was used. Parent recipe hash: de66b6d2160b2011.
Mutation: `fw-mutation-v1`, seed `0x79e3a621`, 24 explicit siblings, mixed all/seed/emitter/field scopes, bold intensity; sibling 16 selected. Child recipe hash: 75058a8716a32fac; canonical RGBA8 hash: 48bb6c6cd20bab15.
Canonical FW-012 CPU raster: exact tick 176, 160×120 crop, centre (chunk 12, -7; local 128,128), 1.25 world units per pixel. Independent reference tick 20. No WebGL pixels used.

## Selection

The actual six-panel canonical contact sheet was inspected. Parent panel 1 is a sparse hooked branch. Selected panel 2 / sibling 16 changes the topology and occupied silhouette: a saturated node releases several long cyan threads with differently bending tangents. The air between trails and the broad dark upper/lower registers are essential, not blank filler. Panel 3 is visually more congested at the knot; panels 4 and 5 are relatively parent-like; panel 6 preserves a more isolated fork. The selection values sustained tension and legible branching, not just the largest score.

Search and filtering: 24 actual normalized FW-011 mutants, replayed at one crop/tick, compared by decoded FW-012 occupied-pixel silhouettes, parent XOR, 20-pixel spatial spread and pairwise XOR. A shared early tick checks temporal evolution; simple palette changes cannot create a silhouette difference. All 24 identities and explicit configs are retained in `atlas.manifest.json`.

## Artifacts and replay

- `selected.recipe.json` — loadable typed recipe with complete lineage.
- `selected.png` and `selected.provenance.json` — exact canonical CPU proof, output hashes and full recipe.
- `parent.png`, five `candidates/NN.recipe.json` plus corresponding canonical PNGs — same-tick comparison.
- `atlas.png` — six-panel display-only contact sheet; not a standalone simulation frame.
- `atlas.test.mjs` — regenerates every committed byte, checks normalization/lineage and tile-order replay.

Run `npm run verify` on Node 22/24, or `node --test gallery/variants/03-offworld-fold/atlas.test.mjs`. All assets use only repository-local dependencies; no source/engine/editor or prior artwork changed.
