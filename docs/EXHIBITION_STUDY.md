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

Use **Next visible mark** to jump from the current coordinate to the next decoded pixel that differs from the versioned FW-012 background, wrapping around the crop. This is especially useful for sparse, mostly empty compositions; a wholly blank crop is reported without manufacturing a mark.

### Keyboard-first canonical pixel navigation

Tab to a visible artwork image in the study dialog. Press **Enter** to inspect its centre source pixel. With the image focused, arrow keys move **one decoded source pixel**; **Shift+arrow** moves ten (clamped to the crop). The readout, selected image A/B, and 9×9 neighbourhood follow each movement. On a two-up study, Tab to the other image and Enter starts at that image's own centre; the artworks' world crops are not aligned. The image receives a visible keyboard focus outline. The source-coordinate/colour readout stays immediately above the framed artwork, so narrow-screen keyboard navigation does not require scrolling past both A and B to discover the selected pixel. When focus is elsewhere in the dialog, Left/Right continue to browse between accepted works.

This uses the exact already-verified in-memory canonical PNG proof and never requests `blob:` over `fetch`, reads GPU pixels or changes the authored recipe. Dedicated Firefox/Chrome WebDriver coverage sends real key actions, checks A/B independence, Shift motion and a narrow viewport, and records screenshots. The numeric controls remain available to keyboard and assistive-technology users.

### Export the accepted exhibition from the study

After **Render visual index (4 CPU proofs)** and **Study accepted works / compare**, use **Save accepted board (HTML)** without leaving the study, even while A/B is pinned or an exact pixel is selected. This delegates directly to the already-accepted **Save offline board** action; it neither generates another image nor changes the working recipe. The browser requests one standalone HTML file containing all four independently verified accepted canonical PNGs and their reproducible provenance. Open the saved file in Firefox, including offline, to browse the proofs and examine their immutable recipes. A request is not proof that the operating system wrote the file.

The dedicated Chrome/Firefox browser gate also writes the actual generated HTML Blob to disk, reopens it via `file://`, independently decodes and checks all four embedded canonical RGBA8 identities, exercises keyboard navigation in the narrow layout (390px Chrome; Firefox WebDriver's observed 500px window minimum) and retains screenshots plus `exhibition-accepted-offline-<browser>.html` as a runnable CI artifact. This checks an authentic offline document in both browsers, **not** the user's OS download-manager persistence or physical Firefox acceptance. The HTML can be opened directly in Firefox without running the FIELDWEAVER server.

The study does **not** embed or admit submitted original or mutation Drafts. To compare unadmitted work, use the separate receipt-qualified `scripts/review-gallery.mjs` path in `docs/GALLERY_REVIEW.md`. Keyboard **P** re-pins the current work as A and immediately rebinds any open source-pixel readout to the new A image, clearing the former A identity; it is equivalent to clicking **Pin current as A**. The Chrome/Firefox WebDriver regression checks both operations, the four genuine embedded accepted PNG identities and that the dialog and inspected pixels survive the export request.


### Recover accepted recipes from the offline board

The saved self-contained HTML board now offers **Save importable recipe** and **Save full provenance** under each of the four accepted CPU images. The first is a normalized `.fwrecipe.json` that can be opened using **Recipe persistence → Load recipe** without adopting another work first. The second records that exact accepted artwork's canonical tick, crop, decoded RGBA8 image identity and replay receipt; those exhibition framing settings are not silently embedded in the recipe. Both are encoded as local `data:` links: the board makes no request, runs no script and keeps strict CSP. After downloading, confirm your browser actually saved both files. This is not permission to admit pending gallery Drafts.

Source-level tests verify all four downloaded JSON byte streams against accepted canonical receipts and versioned importable recipes. The dedicated Chrome/Firefox browser regression checks the same links from the reopened offline HTML and keyboard focus. Automated verification of encoded bytes is not physical operating-system download or recipe re-import acceptance.


The offline handoff regression additionally exercises **real Chrome/Firefox keyboard-initiated data: downloads** from the reopened `file://` board, checks the on-disk recipe and provenance bytes against the exact accepted payloads, and imports the saved recipe through the ordinary workbench file input. Its screenshot and JSON receipt are archived as `exhibition-offline-reimport-<browser>.*`. These are automated browser/OS-file checks, **not** owner physical Firefox or file-manager acceptance.
