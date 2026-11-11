# Variant 09 — cross-gallery admission handoff (11 November 2026)

**Status:** Draft #62, not admitted. No new mutation lineage was started.

Open **[cross-variant-review.html](./cross-variant-review.html)** directly in Firefox. This static, offline, scriptless five-panel comparison embeds actual canonical CPU PNG bytes from immutable Draft heads: #62 (09), #58 (08), #50 (06), #48 (05), #35 (01). The independent [contact-sheet.png](./contact-sheet.png) still compares variant 09's accepted parent and four finalists. [cross-review.test.mjs](./cross-review.test.mjs) verifies every embedded source Git blob and decoded RGBA8 identity, plus the original 09 PNG byte identity.

## Curation after directly inspecting selected images

| Work | Preliminary decision | Visual basis |
|---|---|---|
| #62 / 09 | **Nominate for human review** | Three differentiated registers, including a green–magenta line ending in red; inherited violet staff and established palette are limitations |
| #58 / 08 | **Overlap check** | Arched cyan shape and violet right-hand stop are more contained, but resemble 09's chromatic syntax; do not accept both by default |
| #50 / 06 | **Preserve as different form** | More coherent folded cyan basin; clipped purple detail and large empty field |
| #48 / 05 | **Deprioritize / reject if exhibition space is limited** | Thin cyan carrier, small hot dot, disconnected violet fragment; less architectural differentiation |
| #35 / 01 | **Keep as dense alternative** | More widely distributed polychromatic crossing; risk of muddled lower overlap |

These are editorial readings of the **actual fetched archived PNG images**, not browser-screen observations or an automatic ranking. Their ticks/crops differ; no quantitative silhouette XOR across this set is justified.

## Unchanged selection identity

- Immutable accepted parent: `timeline-pulse`, recipe hash `c94aed7bfc18a40d`; original six commands including freeze/resume preserved.
- First seed `0x27c9ed14`: 16 `all/bold/6` siblings. Second seed `0x4a1f8307`: `fields/bold/1`, sibling 01. Selected seed `0xdcf0c8eb`.
- Selected recipe hash `13451f213af22af1`; immediate stage-two parent `eb22edcbd2d41b38`; lineage identity `b0896193ab13e8ea`.
- Tick **124**; crop **256×192**, centre (126,128), scale **0.75**; 4096-agent and 250000-deposition bounds.
- Canonical RGBA8 `753ce0ca6b5e2aea`; state `d1f31b7f2ed7a514`; deposition `7fe55b30e6e5b6e0`; result `dd65ce8382e9aa9a`.
- 16 unique family pixel IDs; 4 morphology-separated finalists; selected 1932 occupied pixels, 16 bins, parent-mask XOR 2203 at identical within-family framing.
- Existing `selected.recipe.json`, `selected.png`, `selected.provenance.json`, `manifest.json`, `build.mjs`, `atlas.test.mjs` remain unchanged.

## Evidence and remaining acceptance gate

Prior [exact-head CI 42979646422](https://github.com/techrote/FIELDWEAVER/actions/runs/42979646422) at `ae99afa973fc102158614c8e3045b0c4dc19f37ca3` is **not** this branch's head (the actual 09 head is `ae99afa973fc102158614c8e8237a5ebbbaaf941`). At the actual head, [PR CI 42979646422](https://github.com/techrote/FIELDWEAVER/actions/runs/42979646422) passed 4/4 jobs; Node 22/24 each reported **136 passing tests, 0 failures**. The Node 24 `FW_ATLAS_REPORT` logged 16 candidates, selected index 1, canonical RGBA8 `753ce0ca6b5e2aea`, and zero missing archive files. The original within-family test executes real FW-012 replay, compares all ten archived bytes, normalized recipe roundtrip, preserved timeline/lineage, decoded PNG pixels and alternative raster tiling. Following this additional offline curation artifact, a fresh CI must qualify the new head. Direct local `npm run verify` was unavailable because GitHub DNS resolution failed in the working container.

For full current-main **physical Firefox** import/export, use separate worktrees and the already-merged offline review builder:

```sh
git fetch origin pull/62/head:refs/heads/review/pr62
git fetch origin pull/58/head:refs/heads/review/pr58
git worktree add ../FIELDWEAVER-pr62 review/pr62
git worktree add ../FIELDWEAVER-pr58 review/pr58
node scripts/review-gallery.mjs --out fw-curate-09-08.html \
  --preset timeline-pulse --preset operator-atlas \
  --provenance ../FIELDWEAVER-pr62/gallery/variants/09-after-the-fourth-pause/selected.provenance.json \
  --provenance ../FIELDWEAVER-pr58/gallery/variants/08-errant-diagonal/selected.provenance.json
```

Open `fw-curate-09-08.html` in Firefox. Inspect actual works, recorded provenance, downloadable canonical PNG/recipe, then import 09's recipe to the real editor and confirm save/load. This has **not** been performed physically by this worker. The review builder does not accept or merge Draft works.

**Integration decides aesthetic admission and guarded merge.** Do not change earlier art, shared code or accepted catalog. No new variants until the backlog is triaged.
