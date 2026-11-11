# Accepted canonical gallery study

This is an optional full-window browsing and comparison view over the **four accepted FW-014 presets**. It complements the existing 96×64 canonical visual index, not the separate unmerged-candidate proof desk.

## Firefox evaluation

1. From current source, run `npm ci`, `npm run verify`, then `npm run serve` and open `http://127.0.0.1:4173/`.
2. Under **Exhibition · accepted presets**, choose **Render visual index (4 CPU proofs)**. Wait until the status reads **Visual index ready: 4/4**. Only then is **Study accepted works / compare** enabled.
3. Open the study. Use **Previous / Next** or **Left / Right arrows** to browse the actual decoded CPU exports full-window, together with accepted seed, tick, crop, recipe identity, raw RGBA8 identity and lineage.
4. Choose **Pin current as A**, then browse another work to form a side-by-side A/B comparison. **Clear A** returns to one-up inspection. Press **P** to pin using the keyboard.
5. Choose **Load selected into editor** to invoke the existing explicit, transactional preset adoption path; the study closes first. **Escape** or **Close** leaves the editor untouched.

The images are neither generated twice nor substituted with WebGL, stock images or a simulated picture. This view **reuses only the object URLs already created by the opt-in canonical visual index** after its software-raster, PNG decoding, receipt and catalog checks. It accepts no URLs from other sources. Rebuilding the index closes the study before the index may revoke old image URLs. The readout does not infer image similarity or quietly align differing crops. It never admits pending Original Compositions or Mutation Atlas PRs.

Native dialog, buttons, visible focus indicators and keyboard shortcuts support accessibility; there is no autoplay, polling network API, telemetry or external asset. The source-only regression checks verify catalog cycling, display metadata, actual golden CPU proof identities and recipe immutability. The dedicated Chrome/Firefox smoke opens the dialog, browses, pins and loads, captures a real screenshot, and records image decoding. Those browser observations must be qualified separately from Node tests.


## Inspect actual decoded pixels

Open the canonical gallery study after generating the four verified CPU proofs. Choose **Inspect exact pixels** or click an image. Column and row inputs are keyboard-editable and report its exact source pixel RGBA8 tuple, RGB hexadecimal colour and the complete decoded-image identity. The 9×9 magnification is a noncanonical nearest-neighbour presentation of the original PNG bytes, never a new export.

A/B comparison samples each image independently; their authored world crops must not be mistaken for aligned coordinates. The inspector retrieves only the visual index's already-verified, in-memory FW-012 PNG bytes (bound to the displayed local blob URL); it re-decodes using FW-012 and rejects dimensions or decoded-pixel hashes that disagree with accepted records. Rebuild, cancellation, closing and page disposal invalidate its cache. No WebGL readback, external resource, telemetry or recipe changes.
