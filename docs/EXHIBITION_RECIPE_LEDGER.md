# Read-only recipe score in accepted canonical study

FIELDWEAVER's accepted-gallery study reuses four locally generated and verified CPU proof PNGs. The **Inspect recipe score / differences** disclosure adds the underlying normalized authoring recipe facts for an image selected in the full-screen study.

## User path

1. Start the local server with `npm run serve`, open `http://127.0.0.1:4173/` in Firefox, and choose **Render visual index (4 CPU proofs)** in **Exhibition · accepted presets**.
2. Wait until **Visual index ready: 4/4**; open **Study accepted works / compare**. Expand **Inspect recipe score / differences**.
3. See the recipe/engine version, root seed, exact target tick, authored crop, ordered field operators, material behaviours, emitter schedules, LUT logic, intervention ticks and lineage. Every dimension carries an exact fingerprint of its normalized data.
4. Pin artwork A, then browse artwork B using Previous/Next or Left/Right. Read **Identical** versus **Different** comparisons for each dimension and the ordered tick/command-ID intervention registers. A different setting does **not** imply that two pictures look different; the images keep their individually authored framing.
5. Choose **Save reproduction / comparison record (.json)** to download the selected IDs, verified decoded RGBA8 identities from the accepted visual index, recipe hashes, detailed fingerprints and event register for A and optionally B.
6. Close or press Escape. The editor's recipe, simulation state, timeline and export settings remain unchanged unless you separately invoke **Load selected into editor**.

Only the four accepted builtin recipes can appear in this ledger. Pending original or mutation-gallery PRs are not admitted. No external URLs, service, telemetry, WebGL pixel sampling, manual PNG invention, mutation or canonical simulation change occurs.

## Qualification

`npm run verify` checks syntax and the full deterministic suite. `tests/exhibition-recipe-ledger.test.mjs` checks actual software-rendered accepted proofs, unchanged recipe IDs, exact dimensions/fingerprints, command ordering and parent lineage. The separate **Exhibition Recipe Ledger** workflow runs its UI in real Chromium and Firefox sessions, checking four decoded CPU proofs, single/A–B study, field/material differences, six ordered Timeline Pulse commands, JSON download, read-only editor identity and actual screenshots. Do not claim visual/browser acceptance unless those specific browser jobs passed.

## Implementation boundary

The gallery study owns image lifetimes and canonical proof validation. This component reads its already-decoded `blob:` images and their accepted visual-index hashes, not independent preview images. The authoring score is generated from trusted builtin normalized recipes; the panel closes when those verified image resources disappear. The structured score has version `fw-exhibition-recipe-ledger-v1`; it is a human selection/provenance report, not a new canonical export or recipe format.

## Canonical-image custody

The ledger now uses the live accepted visual-index registry to match accepted ID, current object URL and 64-bit decoded RGBA identity before reading the image. It independently decodes FW-012 PNG bytes and verifies dimensions and row-major RGBA hash, then revalidates again at download time. A forged HTML data hash, stale URL or revoked proof after cancellation/rebuild cannot produce an accepted comparison record. No CSP relaxation, `fetch(blob:)`, WebGL readback or new gallery screen is required.
