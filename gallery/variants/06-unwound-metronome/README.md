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

## Independent admission shortlist — 11 November 2026

**Recommend this existing specimen for first owner/Integration review, not automatic admission.** I reopened the actual archived canonical CPU PNGs: this family's accepted parent, selected sibling 17 and all five finalists; the competing selections in mutation Drafts #62 (including its parent and finalists 00/11/13), #58, #55, #48 and #38. These are source-image observations, not photographs of the live editor or physical Firefox acceptance.

Sibling 17 is the only finalist here with a substantial continuous **folded cyan basin**: closely spaced inner arcs descend, flatten across the bottom, then rise to the right. That coherent, broad silhouette is visibly more developed than the accepted Timeline Pulse parent's descending diagonal; the pinned same-crop parent-mask XOR is **3,561**. The other finalists either retain a short descending strand, break into separate scraps or evacuate the central region. The inherited clipped violet left register is an artistic liability, not evidence of new structure.

The competing #62 selected sibling 01 preserves the parent's combination of an upright violet mark, descending cyan trace and short rainbow ribbon in nearly the same arrangement; despite its nontrivial within-crop mask difference, it reads less independent than this basin. #58 has a stronger arch but repeats the violet terminal vocabulary. #55 is a dramatically simpler cyan hook; #48 is a short lateral carrier, and #38 a more compact broken orbit. **Prioritize #50 for a single human admit/reject decision; defer #62 and #58 as potentially overlapping gestures.** Do not merge the alternatives simply because their hashes differ. The compared works have different crops and ticks, so no cross-PR mask-XOR claim is made.

**One-command owner review from the Draft #50 checkout** (Node 22/24, repository root):

```sh
node gallery/variants/06-unwound-metronome/review.mjs
```

This uses the existing, independently checked offline board to re-render two genuinely **ACCEPTED** presets (Timeline Pulse and Operator Atlas) and this one **UNMERGED** candidate. It verifies the archived `selected.png` pixel-for-pixel against a fresh CPU replay, embeds actual canonical PNGs, and offers recipe/provenance downloads. Open the printed HTML path directly in Firefox, then load the downloaded candidate recipe in the live FIELDWEAVER editor and replay tick 148. The generated filename is protected against overwriting an earlier review; an alternate path may be passed as a single argument. This is not a gallery admission or physical Firefox acceptance result.

**Fast physical review from current `main`** (leave this Draft unmerged and preserve separate worktrees):

```sh
git fetch origin pull/50/head:refs/heads/review/pr50
git worktree add ../FIELDWEAVER-pr50 review/pr50
node scripts/review-gallery.mjs --out fw-unwound-review.html --preset timeline-pulse --preset operator-atlas --provenance ../FIELDWEAVER-pr50/gallery/variants/06-unwound-metronome/selected.provenance.json
```

Open `fw-unwound-review.html` in Firefox for accepted-versus-proposed source-pinned comparison. The already committed `atlas.png` gives the parent and five real same-tick finalists; inspect `selected.png` at native pixels. Then import `selected.recipe.json` in the live editor, replay **tick 148** at the exact declared crop, and compare with `selected.png`/`selected.provenance.json`. This final physical import/export and aesthetic judgement are **still pending**. Integration's next action is **admit or reject #50 after that one browser check**, not commission more mutations.
