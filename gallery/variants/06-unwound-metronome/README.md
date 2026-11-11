# Unwound Metronome — the hollow count

A two-generation FW-011 mutation study of the **accepted and immutable Timeline Pulse** recipe, retaining its deliberate intervention schedule. Eighteen independently seeded descendants explore whether fixed-step pulses, frozen intervals and changes in field/emitter geometry leave an evocative afterimage.

## Selected composition

**Sibling 17 (contact-sheet panel 2)** was chosen after actually inspecting the FW-012 CPU contact sheet and the full selected frame. A folded cyan filament forms a wide open U with multiple nested striations. A cropped vertical violet registration at the left opposes the mostly empty upper-right plate. Other finalists reduce to small rainbow scraps or short falling cyan strands. This is a quieter hollow basin rather than the long extended arc of *Broken Orbit* (#38) or the near-horizontal carrier of *Faulted Confluence* (#48). The left-edge crop remains an aesthetic weakness and owner acceptance is not presumed.

## Exact lineage and reproduction

- Immutable accepted parent: `timeline-pulse`, recipe hash `c94aed7bfc18a40d`.
- Stage-one compound mutation seed: `0x91d0ca35`; stage-two seed `0x38ab21fe`. Eighteen candidate indexes (0–17) and topology-safe mutation operations are recorded in `atlas.manifest.json`.
- Chosen child: sibling **17**, normalized recipe hash `309ebd5fd0f01383`, raw decoded canonical RGBA8 FNV-1a-64 identity `80a5a090d57b6d07`.
- Target tick **148**; early comparison tick 34; common **192×144** pixel crop, centre (128,125), chunk (0,0), 0.75 world units/pixel.
- Agent capacity 4096; maximum depositions 250000; canonical FW-012 software raster, tiles 31×23 and independent check 37×29.

Load `selected.recipe.json` in FIELDWEAVER. `selected-bridge.recipe.json` supplies the recorded intermediate generation; each has a versioned FW-011 ancestry. `selected.png` is the true canonical CPU export, paired with `selected.provenance.json`. `parent.png` and the five distinct finalist `candidates/*.png` images are independent same-tick CPU exports. The six-panel `atlas.png` is *only* a display assembly, not a canonical export.

The manifest includes all 18 configs, recipe and raw RGBA identities, parent silhouette XOR, spatial coverage, selected early/late difference and both mutation generations. Five finalists have separate decoded identities and at least 120 pixels of pairwise silhouette difference, so colour-only substitutions do not count.

Run `npm run verify`, or `node --test gallery/variants/06-unwound-metronome/atlas.test.mjs`. Its self-contained regeneration checks exact committed asset bytes, selected recipe import/export, ancestry, replay and alternate raster tiling. No shared engine, UI, original-art, catalog or other worker files have been modified. Draft for Integration and human aesthetic acceptance.
