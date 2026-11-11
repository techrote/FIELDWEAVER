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

**Integration requalification (11 November 2026):** The six embedded archived canonical CPU PNGs have been independently decoded and their raw RGBA8 FNV64 identities checked against the displayed records. The images were visually compared at meaningful enlarged pixel scale: Rooms has the strongest architectural hierarchy; Unwound has the clearest unified cyan curve; Manta remains distinctly wing-shaped but sparse; Fourth Pause overlaps the temporal-mutation vocabulary and stays deferred. This is not a claim of human artistic admission or physical Firefox import acceptance. The generated page remains the owner decision surface. Do not merge these art PRs solely for green CI; all remain Draft until a legitimate artistic decision. Do not revise artists' canonical outputs or add them to accepted presets without admission.

In GitHub Actions the `Admission Review` workflow independently generates the same HTML from exact pinned PR heads, replays every candidate, and exercises real Chrome and Firefox `file://` page checks plus screenshots. CI browser results do not establish physical owner download-manager or editor import acceptance.

**Pinned-head maintenance, 11 November 2026:** Original #57 and mutation #50 were refreshed to exact current PR heads after independent Git-tree comparison verified every archived recipe, PNG, provenance and generation asset was unchanged; only their artwork-local test code had advanced. The generator still refuses later unreviewed head movement. A source-pinned HTML generated before this adjustment remains an archived snapshot, not a representation of new PR commits.

**Source-pin correction (11 November 2026, follow-up):** PR #57 advanced from `c2acad1ee50047e49a02fe36ae6c946d18e89c1f` to `384ef7dd2f5d162b439b916e2ba03d6f30922e47`; PR #50 advanced from `8dc942e3a75580e85983f53f97037e03fb26a06b` to `25e6de1906e3e5a4ee66345b8210028b47185507`. GitHub commit comparisons show changes confined to `docs/ADMISSION_REVIEW.md` and `scripts/admission-review.mjs` on both branches; neither changed any authored recipe, canonical PNG, provenance, generation or atlas asset. Pinned raw RGBA8 identities remain `56286fc4c1a47bb8` (Rooms) and `80a5a090d57b6d07` (Unwound). The CI workflow must still independently regenerate the candidate images, compare decoded pixels, and exercise real Chrome/Firefox `file://` review. This maintenance change neither admits artwork nor substitutes for a physical owner decision.
