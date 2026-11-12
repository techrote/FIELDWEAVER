# Offline canonical artwork review

The accepted browser Exhibition panel deliberately contains only admitted recipes. This separate **curatorial review entrypoint** compares a built-in accepted preset with pending original or mutated artworks **without merging or registering those candidates**.

It generates one static, offline HTML file. Every image is produced by the existing FW-012 CPU software exporter, never by WebGL, screenshots, an image service or the browser canvas. A candidate can appear only if its versioned `*.provenance.json` file replays to the recorded recipe/state/deposition/result/raw-RGBA identities **and** its sibling `*.png` decodes to exactly the regenerated RGBA pixels. The candidate is explicitly labelled *UNMERGED CANDIDATE*. Failure stops the review; it does not silently replace the archived work.

## Current curated shortlist — single owner entrypoint

Run `0Review.cmd` on Windows or `sh ./0Review.sh` on POSIX from current main. After `npm run verify`, the launcher checks each live PR head against the exact SHA pinned in `scripts/admission-review.mjs`, compares each authored recipe with its provenance recipe, reproduces and byte-compares its canonical CPU image, and opens **one** new offline HTML. It never registers or admits a Draft. Network/GitHub access is needed during generation to fetch candidate heads; the resulting HTML is self-contained and works offline.

| Rank | Unmerged Draft | Exact source at curatorial pin | Decoded RGBA8 identity | Admission gate |
| --- | --- | --- | --- | --- |
| 1 | [#57 Registry of Vacant Rooms](https://github.com/techrote/FIELDWEAVER/pull/57) (original) | `23cd907ddf260baf5420b611fe8359d590fcd9dc` | `56286fc4c1a47bb8` | Owner judgement on composition and ten occupied top-edge pixels (author advises keeping crop) |
| 2 | [#50 Unwound Metronome, sibling 17](https://github.com/techrote/FIELDWEAVER/pull/50) (mutation) | `25e6de1906e3e5a4ee66345b8210028b47185507` | `80a5a090d57b6d07` | Owner judgement on lateral crop and selected variant |
| 3 | [#41 The Interval Engine](https://github.com/techrote/FIELDWEAVER/pull/41) (reserve original) | `c6f5ecc0995071c45ae90a00d53ee23dc53b6641` | `fd389a9bb0ce640f` | Owner compare/admit/revise/reject; no substitute for physical import/export inspection |

This remains a **bounded, ranked comparison**, not automatic artistic acceptance. A live head moving invalidates its pin and stops generation until Integration reviews and updates the exact source. No accepted catalogue or artwork bytes change when a candidate enters this review. Do not infer artistic quality from passing deterministic tests.

## From accepted main

Requires Node.js 22–24. From the repository root:

```sh
npm run verify
node scripts/review-gallery.mjs --out fw-review.html --preset first-weave --preset operator-atlas
```

Open `fw-review.html` directly in Firefox. It is standalone, uses no network resources or scripts, and has keyboard-operable links, native details/summary controls, visible focus indicators, responsive comparison panels, exact framing/seed/hash/lineage readouts, and downloadable canonical PNG, normalized recipe and provenance per artwork. Its images are embedded from actual CPU-generated PNGs; there are no invented thumbnails.

## Compare unmerged compositions without changing main

Fetch PRs into **separate worktrees** so the Integration checkout remains authoritative and each artist's files stay unchanged. For example, from the current main worktree:

```sh
git fetch origin pull/34/head:refs/heads/review/pr34
git fetch origin pull/35/head:refs/heads/review/pr35
git fetch origin pull/37/head:refs/heads/review/pr37
git worktree add ../FIELDWEAVER-pr34 review/pr34
git worktree add ../FIELDWEAVER-pr35 review/pr35
git worktree add ../FIELDWEAVER-pr37 review/pr37
node scripts/review-gallery.mjs --out review-20261111.html \
  --preset first-weave \
  --provenance ../FIELDWEAVER-pr34/gallery/originals/01-nocturne-in-countercurrent/nocturne-in-countercurrent.provenance.json \
  --provenance ../FIELDWEAVER-pr35/gallery/variants/01-countercurrent-canticle/selected.provenance.json \
  --provenance ../FIELDWEAVER-pr37/gallery/originals/02-the-luminous-ledger/the-luminous-ledger.provenance.json
```

Use the equivalent multiline quoting/line-continuation syntax for PowerShell or CMD. You may pass up to eight `--preset` and `--provenance` entries in any order. A provenance input must have a same-stem `.png` next to it. The review reads them only; no PR artwork, provenance, original, or existing file is modified.

The HTML output path must **not already exist**: choose a fresh name. This is intentional protection against silently overwriting a previous evaluation. No server, external asset, telemetry or API token is needed to open the result. Candidate PRs can continue to develop independently.

## Qualification and boundaries

The gallery-review verifier checks all 20 provenance identity fields and decoded RGBA8 against an independently regenerated raster, using 4096 agent slots, a 250,000-deposition cap and a deliberately non-square 47×39 raster tiling. Inputs are bounded to eight entries, 8 MiB of provenance per entry, tick 0–512 and at most 1024×1024 pixels per crop. A source that exceeds this budget requires a separate bounded qualification path, not relaxed identities. This workflow covers the present #34, #35 and #37 examples by their documented sizes, ticks and capacities; it does not imply those candidates have passed this new workflow until executed.

Source-level and canonical regression tests are in `tests/gallery-review.test.mjs`; `npm run verify` executes them. The HTML is a convenience for independent **human artistic evaluation**, not an automated aesthetic acceptance judgment and not a permanent catalog registration. Results can be visually inspected in Firefox before guarded admission. The canonical simulation, rendering contract and accepted preset catalog are unmodified.

If a candidate's PNG or provenance is missing, forged, incompatible, or non-reproducible, the program fails instead of offering a misleading preview. It does not judge novelty beyond flagging exactly duplicate image identities within one comparison. Pixel-hash identity is only meaningful for the stated crop/tick; different crops or dimensions cannot be treated as direct pixel-level comparisons.

**Current status:** This is an opt-in evaluation tool. It does not merge artwork PRs, mark them accepted, alter the local-first app or change the authoritative main exhibit.
