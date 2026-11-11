# Proof Desk — independent offline canonical artwork verification

This is an opt-in **browser exhibition/acceptance tool**, separate from the live WebGL workbench and from the accepted-preset catalogue. It makes a downloaded FIELDWEAVER export inspectable without opening a repository PR worktree or running the artwork author's script.

## Open in Firefox or Chromium

From a checkout of the branch, run:

```sh
npm ci
npm run verify
npm run serve
```

Open **http://127.0.0.1:4173/proof-desk.html**. The ordinary workbench remains at the root. A single local server is needed for native ES module imports; no network service or external dependency is used. This standalone page does not merge, import into, or modify any accepted recipe.

Choose a `fw-export-provenance-v1` JSON receipt created by FIELDWEAVER's canonical exporter (for example, the downloaded sidecar from **Canonical export**). Optionally choose its native, unmodified RGBA PNG file. Activate **Verify & reproduce**. The desk independently executes the authoritative FW-012 CPU renderer at the receipt's explicit seed, target tick and crop using non-square 47×39 raster tiles.

A successful receipt check produces an **actual regenerated canonical PNG** and the recorded seed, recipe hash, crop, tick, state and decoded RGBA identity. If the archived PNG was also supplied, its **decoded RGBA8 pixels** are checked byte-for-byte against the regenerated image; a failed, non-RGBA or unsupported-encoding file is rejected rather than displayed as credible proof. The regenerated image and its verified receipt can be downloaded. The page marks whether the archived PNG was checked; a receipt-only success **does not** assert that an external PNG was verified.

## Reproduction/acceptance boundaries

- This is not a WebGL or Canvas2D pixel oracle. The image shown comes solely from `createCanonicalExport`. The page uses a `data:` PNG URL for display, within the existing local HTTP server's conservative CSP; it neither fetches an image service nor uploads user files.
- All 21 current provenance fields are matched against independently calculated fields, including the normalized recipe, seed, all versions, lineage, replay state/deposition/result hashes, crop, background and raw decoded RGBA8 identity. Unknown receipt fields or incompatible schema versions are rejected.
- Deliberate bounded review inputs: 4 MiB receipt, 8 MiB native PNG, target tick at most 512, each crop side at most 1024, total at most 1,048,576 pixels, 4096 agents and 250,000 depositions. Larger artwork requires a separately qualified bounded run; limits must not be silently widened merely to claim an acceptance.
- The optional PNG verifier is intentionally restricted to the project's dependency-free canonical RGBA8 PNG encoding (stored zlib/deflate, PNG filter 0). Losslessly re-encoded indexed or compressed PNGs might have identical decoded colours but are rejected as *unsupported* rather than compared by browser Canvas2D. The provenance-only mode remains available for those works, with the limitation stated in the UI.
- Verification establishes **machine reproducibility for the supplied versioned receipt**. It cannot attest authorship, licensing, novelty, subjective quality, or that a branch has been accepted on `main`. Pending original and variant PRs remain candidates until Integration admits them.

## Tests

`tests/proof-desk.test.mjs` replays an accepted golden work through two different raster tile dimensions, checks provenance and optional native PNG, and rejects altered hashes, forged fields, oversized crops/ticks and corrupt PNGs. `npm run verify` includes these tests. The dedicated browser smoke exercises upload/replay/image decoding and invalidation in real Firefox and Chrome via `scripts/proof-desk-browser-smoke.mjs` when browser drivers are available.

The new page deliberately does not modify simulation, recipe schema, GPU preview, existing export, accepted artwork assets, or the pinned two-up comparison of accepted works.
