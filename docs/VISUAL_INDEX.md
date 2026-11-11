# Accepted exhibition visual index

The **Render visual index (4 CPU proofs)** action turns the four existing accepted FW-014 preset buttons into a visual selection surface. It never admits pending artwork, replaces the catalog or changes the working recipe.

## Evaluate in Firefox

1. Launch locally with `npm run serve` and visit `http://127.0.0.1:4173/`.
2. In **Exhibition · accepted presets**, choose **Render visual index (4 CPU proofs)**. Each of the four real FW-012 software-raster exports is generated at its recorded seed, tick and crop; the interface updates between bounded replays.
3. Wait for **Visual index ready: 4/4**. Every card now contains a decoded native CPU PNG and its raw RGBA8 hash. Select a card with mouse or Tab/Enter/Space to inspect its metadata. The existing **Render canonical proof**, **Load preset**, pin A/B comparison and export buttons still work independently.
4. **Cancel** stops at the next boundary between CPU replays without discarding completed images. **Rebuild visual index** regenerates them. Previous object URLs are revoked when replaced and on leaving the page.

No images are shown by default: this opt-in path incurs rendering work only on request. It uses the accepted local recipe catalog, checks the PNG against the software export's decoded pixels and RGBA8 hash, and checks exact receipt/recipe/tick/seed identity. It does not sample WebGL, create synthetic thumbnails, fetch remote art or mutate the editor.

`tests/exhibition-visual-index.test.mjs` exercises the four golden images, immutability, damaged PNG, forged provenance and proxy rejection. `scripts/exhibition-visual-index-browser-smoke.mjs` exercises actual Chrome/Firefox image decoding, native-button gallery selection and screenshot capture under a dedicated workflow. Browser screenshots are aesthetic/layout evidence only, never the canonical oracle.

Pending originals and mutation families remain DRAFT until Integration independently qualifies them. The visual index is intentionally limited to accepted works.
