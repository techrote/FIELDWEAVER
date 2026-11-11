# Owner admission review (accepted vs proposed, offline after generation)

From a checkout of FIELDWEAVER with Node.js 22 or 24 and Git installed:

```sh
npm ci
npm run verify
node scripts/admission-review.mjs
```

Open the newly created `FIELDWEAVER-admission-review.html` in Firefox. The static HTML needs **no server or network connection** after generation, carries no scripts or external images, labels accepted work separately from unmerged candidates, and includes each exact canonical image and downloadable recipe/provenance.

Generation **does require GitHub access once** to fetch four pinned, unmerged PR heads. The script creates temporary **detached** worktrees, leaves the editor, current checkout, accepted catalog and artists' branches unchanged, runs the existing `scripts/review-gallery.mjs` FW-012 replay/PNG/20-field provenance verifier, checks pinned RGBA8 image identities, and only then writes the HTML. It refuses to overwrite a previous review. If a PR head moves, generation fails closed: review the new source and update the pinned SHA deliberately rather than silently depicting stale art as current. Delete the old output file or choose `--out another-new-name.html` to repeat.

The bounded shortlist is deliberately **not an admission vote**. The accepted control works are Operator Atlas and Timeline Pulse. Proposed originals: [#57 Registry of Vacant Rooms](https://github.com/techrote/FIELDWEAVER/pull/57) (tick 162, 432×304) and [#61 The Last Manta](https://github.com/techrote/FIELDWEAVER/pull/61) (tick 166, 480×320). Proposed mutations: [#50 Unwound Metronome](https://github.com/techrote/FIELDWEAVER/pull/50) (sibling 17, tick 148, 192×144) and [#62 After the Fourth Pause](https://github.com/techrote/FIELDWEAVER/pull/62) (sibling 01, tick 124, 256×192). The latter two share the immutable Timeline Pulse ancestor but have materially different silhouettes; their numerical hashes alone do **not** establish artistic distinctiveness.

## Curatorial decision queue

| Priority | Draft | Pre-review judgement | Admission gate |
|---|---|---|---|
| 1 | #57 Rooms | Strong triptych geometry, but a very vacant central register and fine short eastern strokes | Owner examines actual canonical frame at native size and chooses admit/revise/reject |
| 2 | #50 Unwound | Strong unified cyan basin; prior lineages have shorter or differently routed curves | Owner judges clipped violet accent and overlap with other mutation Drafts |
| 3 | #61 Manta | Clearly different animal-wing silhouette, but only 2.88% occupied image pixels | Owner tests legibility and composition versus sparse accepted controls |
| 4 | #62 Fourth Pause | Interesting competing currents, but near-parent and other mutation motifs overlap | Defer until #50 accepted/rejected; compare more narrowly |

These are **provisional selection notes based on authors' source records and earlier inspection receipts, not a fresh claim that Integration visually inspected this run's actual full-size outputs**. The generated page is the means for an independent owner verdict. Do not merge these art PRs solely for green CI; all remain Draft until a legitimate artistic decision. Do not revise artists' canonical outputs or add them to accepted presets without admission.

In GitHub Actions the `Admission Review` workflow independently generates the same HTML from exact pinned PR heads, replays every candidate, and exercises real Chrome and Firefox `file://` page checks plus screenshots. CI browser results do not establish physical owner download-manager or editor import acceptance.
