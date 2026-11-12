# Accepted exhibition visual index

The **Render visual index (4 CPU proofs)** action turns the four existing accepted FW-014 preset buttons into a visual selection surface. It never admits pending artwork, replaces the catalog or changes the working recipe.

## Evaluate in Firefox

1. Launch locally with `npm run serve` and visit `http://127.0.0.1:4173/`.
2. In **Exhibition · accepted presets**, choose **Render visual index (4 CPU proofs)**. Each of the four real FW-012 software-raster exports is generated at its recorded seed, tick and crop; the interface updates between bounded replays.
3. Wait for **Visual index ready: 4/4**. Every card now contains a decoded native CPU PNG and its raw RGBA8 hash. Select a card with mouse or Tab/Enter/Space to inspect its metadata. The existing **Render canonical proof**, **Load preset**, pin A/B comparison and export buttons still work independently.
4. **Cancel** stops at the next boundary between CPU replays without discarding completed images. **Rebuild visual index** regenerates them. Starting a rebuild immediately revokes and hides **all** previous proof URLs and identity labels, rather than leaving stale pixels visible during the new run. Genuine proofs completed in the current run remain visible and source-bound if **Cancel** stops between entries; a failed decode clears partial images and identities. Object URLs are also revoked on leaving the page.

No images are shown by default: this opt-in path incurs rendering work only on request. It uses the accepted local recipe catalog, checks the PNG against the software export's decoded pixels and RGBA8 hash, and checks exact receipt/recipe/tick/seed identity. It does not sample WebGL, create synthetic thumbnails, fetch remote art or mutate the editor.

`tests/exhibition-visual-index.test.mjs` exercises the four golden images, immutability, damaged PNG, forged provenance and proxy rejection. `scripts/exhibition-visual-index-browser-smoke.mjs` exercises actual Chrome/Firefox image decoding, native-button gallery selection and screenshot capture under a dedicated workflow. Browser screenshots are aesthetic/layout evidence only, never the canonical oracle.

Pending originals and mutation families remain DRAFT until Integration independently qualifies them. The visual index is intentionally limited to accepted works.


## Portable offline exhibition field guide

After **Render visual index (4 CPU proofs)** completes successfully, choose **Save offline board (HTML)**. This downloads one self-contained HTML file containing four already verified FW-012 canonical PNGs, each accepted work's recipe/seed/tick/crop/lineage identity, and the complete export provenance JSON (including the loadable recipe) in an expandable disclosure. Images are embedded from original PNG bytes; nearest-neighbour CSS enlargement is a presentation transform only. The document is static, keyboard navigable, printable and has no scripts, telemetry or remote assets. It opens offline.

The button stays disabled until a full four-work pass succeeds. Starting a new pass, cancellation, error or page exit invalidates the pending board evidence. Partially refreshed images cannot be saved as one reviewed set. Board creation never adopts a recipe, modifies simulation state or admits pending gallery submissions.

Each accepted work also offers **Save complete work bundle (ZIP)**, a single self-contained, dependency-free ZIP with its exact original PNG, importable recipe and full provenance as three separately extractable files. The ZIP is a deterministic transport only and is labelled separately from the canonical PNG; it never changes the artwork or its decoded RGBA identity. ZIP entry timestamps use the valid fixed 1980-01-01 DOS date for portability, not the artwork's creation or export date. No additional gallery or editor functionality is introduced.

The offline-board module checks accepted IDs, decoded PNG pixels, crop, receipt versions, recipe hash and seed before embedding them. Tests reject missing, duplicate, corrupted and forged evidence. The Chrome/Firefox browser smoke exercises an actual UI click and reads the resulting HTML download Blob for its four embedded canonical PNGs; it does **not** certify OS-level file persistence. The 96×64 images are review proofs rather than high-resolution exports. For larger output use **Canonical export**.
