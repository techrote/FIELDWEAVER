# Owner admission review — current live shortlist

The one-command review uses the existing canonical FW-012 CPU renderer and static offline exhibition. It does **not** admit artwork or change the accepted gallery.

## Open locally

Requires Node.js 22/24, npm and Git. Initial review generation requires one-time access to GitHub to fetch the exact pinned PR heads. Once generated, the HTML is self-contained and works in Firefox without a server or network.

- **Windows:** double-click `0Review.cmd`.
- **Linux/macOS:** run `sh ./0Review.sh`.
- **Manual:** run `npm ci`, `npm run verify`, then `node scripts/admission-review.mjs --out FIELDWEAVER-admission-review.html`; open the resulting HTML.

The launchers run the full `npm run verify` gate and choose an unused numbered HTML filename. The generator makes detached temporary Git worktrees for the exact candidate heads, independently replays their recipes, checks the versioned provenance and decoded canonical RGBA8 against the archived PNGs, then writes the HTML only after all entries verify. Moved source commits, replay/identity mismatches or verification failures stop generation; a previous review is never reopened as if current. The generated page has no JavaScript, external assets or telemetry.

## Admission queue — 11 November 2026

The **ACCEPTED PRESET** reference works are Operator Atlas and Timeline Pulse. Only the following still-open artistic Drafts are shown as **UNMERGED CANDIDATE**:

| Rank | Draft | Exact canonical artwork | Owner decision |
|---|---|---|---|
| 1 | [#57 Registry of Vacant Rooms](https://github.com/techrote/FIELDWEAVER/pull/57) — original | Seed `0x6da27f19`, tick 162, 432×304, decoded RGBA8 `56286fc4c1a47bb8` | Strong three-register geometry; judge the nearly vacant middle and fine right-hand strokes |
| 2 | [#50 Unwound Metronome](https://github.com/techrote/FIELDWEAVER/pull/50) — mutation sibling 17 | Tick 148, 192×144, decoded RGBA8 `80a5a090d57b6d07` | Clear, unified cyan basin; judge clipped edge pixels and similarity to accepted Timeline Pulse |

**Not in the active selection:** Original [#61 The Last Manta](https://github.com/techrote/FIELDWEAVER/pull/61) was rejected and closed unmerged; mutation [#62 After the Fourth Pause](https://github.com/techrote/FIELDWEAVER/pull/62) was withdrawn and closed unmerged following comparison with #50. Their archived assets and PR branches remain available for historical inspection, but they must not be presented as awaiting admission.

The two live art sources remain **Draft**, unadmitted. Green Node/Chrome/Firefox CI demonstrates technical reproducibility, not owner aesthetic or physical Firefox import acceptance. Owner: inspect each original-size canonical frame, save/import the exact recipe in `0Play.cmd`, reproduce the documented tick and crop, and decide **ADMIT / REVISE / REJECT**. Integration may merge only after that decision and final source-exact qualification.

This short list intentionally does not add another gallery, modal, editor, or accepted-preset record. Further original/mutation submissions stay in their own Draft PRs until specifically selected for review.
