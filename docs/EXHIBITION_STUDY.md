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

A/B comparison samples each image independently; their authored world crops must not be mistaken for aligned coordinates. When **A is pinned**, the same image-local column/row is sampled from both independently verified CPU rasters. The desk reports each RGBA8 tuple and a signed per-channel **Δ(B−A)**. Equal crop geometry is stated explicitly; otherwise the reading says **IMAGE-LOCAL ONLY**, because equal pixel indices do not imply the same world location. The A/B reading is cleared on rebuild, cancellation, source invalidation and close; a stale peer image refuses the comparison rather than supplying cached colour. The inspector retrieves only the visual index's already-verified, in-memory FW-012 PNG bytes (bound to the displayed local blob URL); it re-decodes using FW-012 and rejects dimensions or decoded-pixel hashes that disagree with accepted records. Rebuild, cancellation, closing and page disposal invalidate its cache. No WebGL readback, external resource, telemetry or recipe changes.

Use **Next visible mark** to jump from the current coordinate to the next decoded pixel that differs from the versioned FW-012 background, wrapping around the crop. This is especially useful for sparse, mostly empty compositions; a wholly blank crop is reported without manufacturing a mark.

With **A pinned**, choose **Next A/B difference** or **Previous A/B difference** to traverse forward/backward through source-exact RGBA8 differences between the two accepted CPU images. This scans the common **image-local** rectangle in row-major order, wraps around, and includes alpha-channel differences; it performs no resampling or new rendering. When the authored crops differ, identical column/row coordinates **do not mean world-aligned pixels**. If a selected image coordinate lies beyond the smaller source's overlap, forward/backward navigation re-enters at the first/last differing pixel in that overlap. If all overlapping pixels match, the desk reports that fact without fabricating a difference. The button is disabled without a pinned A; both live source leases are revalidated and the PNG bytes independently decoded before scanning, so forged or expired proof identity cannot leave a stale difference on screen. The existing keyboard-focusable button, source coordinate controls and 9×9 sample provide the interaction; no extra modal, service or editor state is introduced.

### Keyboard-first canonical pixel navigation

Tab to a visible artwork image in the study dialog. Press **Enter** to inspect its centre source pixel. With the image focused, arrow keys move **one decoded source pixel**; **Shift+arrow** moves ten (clamped to the crop). The readout, selected image A/B, and 9×9 neighbourhood follow each movement. On a two-up study, Tab to the other image and Enter starts at that image's own centre; the artworks' world crops are not aligned. The image receives a visible keyboard focus outline. The source-coordinate/colour readout stays immediately above the framed artwork, so narrow-screen keyboard navigation does not require scrolling past both A and B to discover the selected pixel. When focus is elsewhere in the dialog, Left/Right continue to browse between accepted works.

This uses the exact already-verified in-memory canonical PNG proof and never requests `blob:` over `fetch`, reads GPU pixels or changes the authored recipe. Dedicated Firefox/Chrome WebDriver coverage sends real key actions, checks A/B independence, Shift motion and a narrow viewport, and records screenshots. The numeric controls remain available to keyboard and assistive-technology users.

### Export the accepted exhibition from the study

After **Render visual index (4 CPU proofs)** and **Study accepted works / compare**, use **Save accepted board (HTML)** without leaving the study, even while A/B is pinned or an exact pixel is selected. This delegates directly to the already-accepted **Save offline board** action; it neither generates another image nor changes the working recipe. The browser requests one standalone HTML file containing all four independently verified accepted canonical PNGs and their reproducible provenance. Open the saved file in Firefox, including offline, to browse the proofs and examine their immutable recipes. A request is not proof that the operating system wrote the file.

The accepted static board offers three independent native keyboard-focusable downloads per work: **unchanged canonical PNG bytes**, **importable recipe** and **full export provenance**. In the live study, all three selected-work exports require the current verified CPU proof lease; a forged or stale on-screen canonical hash also blocks the recipe download rather than allowing a valid recipe to masquerade as evidence for an invalid displayed image. The downloadable PNG is the exact verified image already displayed, not a new rasterization, screenshot or lossy preview. Its filename identifies the decoded RGBA8 hash; crop/tick are in the provenance. The board additionally offers **Save complete work bundle (ZIP)** for each accepted work. The bundle is a deterministic, uncompressed ZIP/STORE transport containing exactly the original verified CPU PNG bytes, the same normalized importable recipe JSON, and the full versioned export provenance JSON. It is a packaging convenience, not a new canonical image, recipe version, inferred crop alignment or artistic admission. No script, network request or remote service is required to download it from a local `file://` document. Its three member filenames match the independent downloads; the provenance remains the authoritative seed/tick/crop/replay receipt. Browser keyboard download and binary preservation are separately checked in Chrome/Firefox; physical owner filesystem acceptance is not implied.

The static board additionally offers **Save all accepted works (ZIP)** above the gallery: one portable archive of the same twelve original files (four verified canonical CPU PNGs, four importable recipes and four complete provenance receipts) with deterministic valid 1980-01-01 ZIP dates. Every collection member is byte-identical to its individual and per-work bundle counterpart; the archive contains no synthetic thumbnails, manifests presented as canonical truth or unadmitted artwork. The collection is generated only after all four accepted receipts pass the existing source verification. Chrome/Firefox exercise an actual Enter-key file download from the offline board, while Node independently parses all twelve ZIP entries and checks equality with the per-work archives. This is a batch-export convenience, not a new gallery or admission decision.

The page remains script-free, offline and accepted-only. Chrome/Firefox regression exercises real Enter-key download of all three asset types from `file://`, verifies saved bytes and decoded image identity, then reimports the saved recipe into the editor. A browser-initiated download is not a claim about an unrelated owner's filesystem.

The dedicated Chrome/Firefox browser gate also writes the actual generated HTML Blob to disk, reopens it via `file://`, independently decodes and checks all four embedded canonical RGBA8 identities, exercises keyboard navigation in the narrow layout (390px Chrome; Firefox WebDriver's observed 500px window minimum) and retains screenshots plus `exhibition-accepted-offline-<browser>.html` as a runnable CI artifact. This checks an authentic offline document in both browsers, **not** the user's OS download-manager persistence or physical Firefox acceptance. The HTML can be opened directly in Firefox without running the FIELDWEAVER server.

The study does **not** embed or admit submitted original or mutation Drafts. To compare unadmitted work, use the separate receipt-qualified `scripts/review-gallery.mjs` path in `docs/GALLERY_REVIEW.md`. Keyboard **P** re-pins the current work as A and immediately rebinds any open source-pixel readout to the new A image, clearing the former A identity; it is equivalent to clicking **Pin current as A**. The Chrome/Firefox WebDriver regression checks both operations, the four genuine embedded accepted PNG identities and that the dialog and inspected pixels survive the export request.


### Recover accepted recipes from the offline board

The saved self-contained HTML board now offers **Save importable recipe** and **Save full provenance** under each of the four accepted CPU images. The first is a normalized `.fwrecipe.json` that can be opened using **Recipe persistence → Load recipe** without adopting another work first. The second records that exact accepted artwork's canonical tick, crop, decoded RGBA8 image identity and replay receipt; those exhibition framing settings are not silently embedded in the recipe. Both are encoded as local `data:` links: the board makes no request, runs no script and keeps strict CSP. After downloading, confirm your browser actually saved both files. This is not permission to admit pending gallery Drafts.

Source-level tests verify all four downloaded JSON byte streams against accepted canonical receipts and versioned importable recipes. The dedicated Chrome/Firefox browser regression checks the same links from the reopened offline HTML and keyboard focus. Automated verification of encoded bytes is not physical operating-system download or recipe re-import acceptance.


The offline handoff regression additionally exercises **real Chrome/Firefox keyboard-initiated data: downloads** from the reopened `file://` board, checks the on-disk recipe and provenance bytes against the exact accepted payloads, and imports the saved recipe through the ordinary workbench file input. Its screenshot and JSON receipt are archived as `exhibition-offline-reimport-<browser>.*`. These are automated browser/OS-file checks, **not** owner physical Firefox or file-manager acceptance.

### Direct selected-work export from the study

After **Render visual index (4 CPU proofs)**, open **Study accepted works / compare**. Browse and optionally pin A; **Save selected CPU PNG** and **Save selected recipe** export the *currently browsed* work (B when A is pinned). The first revalidates the exact in-memory FW-012 PNG against the current accepted visual-index registry and decoded RGBA8 identity immediately before download. The second uses the existing normalized/roundtrip-checked accepted recipe handoff. Neither changes the editor or infers a shared world crop; the source tick/crop are shown separately. The browser is asked to save a file; actual owner file-manager persistence remains unverified.

On every pixel movement the current proof lease is checked, including cached decoded pixels. A forged/revoked/stale source cannot retain a formerly valid colour reading. No `fetch(blob:)`, WebGL sampling, second gallery subsystem or unadmitted Draft artwork is involved. Chrome/Firefox regression now checks actual saved B PNG/recipe bytes, raw decoded identity, hash, editor immutability and forged-hash cache invalidation.

### Export full provenance for only the selected work

Use **Save selected provenance** alongside the existing selected CPU PNG and importable recipe actions. This requests a third file for the same currently browsed work (B while A is pinned), with the complete versioned FW-012 receipt: accepted recipe, seed, exact target tick, authored crop, decoded RGBA8 identity, and canonical replay/result hashes. The recipe file intentionally does **not** encode the exhibition tick/crop; the provenance file is the reproducible companion. No second replay or WebGL/framebuffer readback occurs.

The download path renews the source-bound verified proof lease, independently decodes the held canonical CPU PNG, and applies the existing offline-board's full receipt/recipe verifier before requesting the file. A stale URL, mismatched pixel hash, altered PNG or forged tick/crop/recipe is refused. Only accepted work is exportable. Chrome/Firefox WebDriver checks real keyboard-initiated on-disk selected B PNG, recipe, and provenance downloads against exact receipts; these are automated browser checks, not physical owner acceptance.

### Portable exact pixel evidence

With **Inspect exact pixels** open, choose an image and source column/row, then press **Save exact pixel receipt (JSON)** (also keyboard-operable). The browser downloads a versioned, deterministic `.fwpixel.json` containing the inspected source coordinate, accepted work ID, normalized recipe hash, seed, target tick, exact crop, raw decoded RGBA8 image identity, and the actual RGBA8 and hex sample. When A is pinned it includes both independently verified sources, the signed B−A channel delta, and a flag distinguishing an identical authored crop from an **image-local-only** comparison. Different crops are never silently reprojected or represented as world-aligned.

Every request independently renews the live visual-index lease and re-decodes both actual in-memory FW-012 PNGs; a forged, revoked, mismatched or out-of-bounds source refuses the download. The receipt is evidence for a sampled pixel, **not** a replacement for the full canonical PNG, importable recipe or versioned export provenance, which remain separately downloadable. No WebGL readback, `fetch(blob:)`, external request, new gallery subsystem or artwork admission occurs.

### Source-exact A/B overlap summary

With the existing pixel desk open and **A pinned**, choose **Summarize A/B overlap** to count every pixel with any changed decoded RGBA8 channel inside the shared **image-local** rectangle. The summary reports the overlap dimensions, differing-pixel count/denominator, inclusive changed-pixel bounds, and maximum absolute B−A change for each RGBA channel. An identical overlap reports zero changes and no bounds. No resampling, colour correction or new canonical render occurs.

This is a literal byte-level comparison of accepted CPU proofs, **not** a perceptual similarity score. Where the authored crops differ, the result prominently says **IMAGE-LOCAL ONLY: NOT world-aligned**; disjoint or differently framed compositions should not be interpreted as having registered world-space features. Every click renews both accepted image leases and independently decodes the held PNGs, never using a prior cached result or `fetch(blob:)`. Re-pinning, browsing, closing or changing a proof invalidates the displayed summary. A forged or expired proof must refuse the request rather than retaining earlier statistics. The calculation is optional, uses only the existing pixel desk, and does not mutate editor state, recipe identity or artwork admission.

### Source-exact A/B index in the accepted offline board

The existing script-free accepted HTML board includes a **six-pair A/B comparison index**, linked from the top navigation. For every two of the four accepted works, it reports the actual decoded CPU RGBA8 difference count, shared image-local dimensions, inclusive changed-pixel bounds and maximum absolute per-channel differences. Each entry links back to its two artworks and their original PNG, importable recipe and full provenance downloads. There is no additional gallery, modal, script, API request or image generation.

The index is computed only after all four canonical PNGs and full receipts pass the normal board acceptance verifier, then independently re-decodes the held PNG bytes. It must never present differences as perceptual similarity or register differently authored world crops. Keyboard users can Tab to the comparison region and scroll horizontally at narrow widths. Node tests check all six pair counts against an independent raw-pixel loop; Chrome and Firefox exercise the actual saved `file://` document, keyboard focus, narrow layout and screenshot archival. The board is accepted-only: pending original/mutation artworks are not admitted.

### Inline original A/B image previews (offline board)

The existing script-free **A/B comparison index** now has **View exact A/B images** under each accepted pair. Expand it with mouse or focus the native summary and press **Enter**. It displays the *same two original accepted FW-012 canonical CPU PNG bytes* as the artwork cards, side by side at desktop widths and stacked on narrow screens. They are CSS `data:image/png` backgrounds on accessible labelled image regions; no second rendering, compositing, canvas, WebGL readback, script, fetch, external asset, new editor or gallery component is introduced. The original image file is still downloadable from its work card.

The accompanying text and the existing receipt explicitly state when crops differ: image-local same-index pixels are **not** world-aligned, and this is neither a synthetic difference image nor a perceptual similarity score. The six native disclosures are initially closed to preserve the compact index and keyboard navigation. Source-level regression byte-compares all twelve displayed source references against their four accepted PNGs and independently decodes RGBA8; Chrome and Firefox reopen the actual `file://` document, activate a disclosure with a real keyboard Enter, verify the visible image CSS sources match the accepted artwork, check responsive narrow stacking, and archive expanded screenshots. Proposed Original Compositions and Mutation Atlas candidates remain excluded.

### Offline exact changed-pixel inspection and CSV export

Each accepted pair in the offline A/B index has an initially collapsed **Inspect exact changed pixels** disclosure. Press Enter on its native summary to inspect every literal differing pixel in deterministic row-major top-left image-local order, with A RGBA8, B RGBA8 and signed B−A RGBA8. The scrollable numeric table works with the keyboard, without a script or network. **Save exact pixel ledger (CSV)** exports the complete table as numeric, 14-column UTF-8 CSV. Its filename binds both accepted artwork IDs and both raw decoded RGBA8 hashes; the adjacent A/B JSON receipt retains the canonical seed/tick/crop provenance.

Both the numeric table and downloadable CSV are computed only from independently verified FW-012 CPU PNG decoded bytes, after the accepted proof/provenance checks, and the ledger count is checked against the separate A/B summary. The rows denote image-local same-index comparisons, **never** alignment of different authored world crops. No derived pixel picture, artistic substitution, new gallery, editor or admission decision is involved. Node independently recomputes all six complete files; actual Chrome/Firefox `file://` browser checks exercise keyboard disclosure, row counts, CSV payloads and screenshots. Physical Windows acceptance remains a separate gate.

### Literal A/B source-colour swatches (offline board)

The existing **Inspect exact changed pixels** disclosure now pairs each A/B numerical RGBA8 tuple with a small alpha-aware checker-backed colour swatch. This makes transparency or subtle source-colour changes visible without decoding CSV columns manually. The numeric 8-bit RGBA8 tuples and signed B−A deltas remain authoritative. CSS sRGB blending is *noncanonical display only*, not new artwork, and never enters PNG, comparison JSON, exact CSV or bundled ZIP exports. Swatches are hidden from assistive technology because exact accessible numeric values are adjacent.

Node tests check every sample against independently decoded accepted canonical PNG bytes. Dedicated real Firefox/Chrome tests inspect the script-free `file://` board under strict CSP, use keyboard focus in full/narrow layouts, and archive source-swatches screenshots.

### Source-exact changed-pixel locator (offline board)

The existing **Inspect exact changed pixels** disclosure also displays a compact
**diagnostic location map**. Its amber unit squares identify the image-local
`(x, y)` positions of *every* pixel whose decoded canonical A/B RGBA8 values
differ; unchanged positions are dark. This is an index to the existing full
numeric table and exported CSV, **not** another canonical image or a visual
substitute for the original two CPU PNGs.

The locator is generated from the same independently checked changed-pixel
coordinates as the ledger, after source PNG, crop, recipe and provenance
verification. It uses native inline SVG with no browser scripts, fetch, blob
URLs, screenshot inputs or external images; it respects the original
offline `file://` CSP. Coordinates are top-left **image-local**, not
world-registered if the two authored crops differ. The original artwork bytes,
canonical hashes, eight-file pair ZIP and accepted/admission boundary are
unchanged.

Node independently checks every diagnostic mark against a fresh decoded RGBA8
scan for all six accepted pairs. The Chrome and Firefox real-browser smoke
opens the offline file, activates the disclosure with the keyboard, validates
all rendered mark coordinates against the numeric table, verifies visible
dimensions and captures the expanded result. Physical Windows owner
acceptance remains a separate gate.

### Portable A/B comparison receipts (offline board)

In **A/B comparison index**, use **Save A/B receipt (JSON)** for any of the six accepted pairs. Each offline `.fwcompare.json` binds both already-verified canonical CPU PNG identities to their immutable recipe hash, root seed, tick and exact authored crop, plus the decoded image-local overlap, changed RGBA8 pixel count, inclusive bounds and maximum absolute channel differences. The receipt explicitly distinguishes identical authored crops from *image-local only / not world-aligned* comparisons. It contains no perceptual inference, recoloured preview, new canonical identity, or unadmitted artwork. Its local `data:` download works under the existing script-free `file://` CSP.

Node independently recomputes raw RGBA8 bounds and deltas for all six receipts. Both Chrome and Firefox decode the links from the actual offline document and keyboard-download a receipt to disk, then compare the saved payload to the accepted source proof identities. Physical owner filesystem acceptance remains separate.


### Complete two-work A/B evidence download (offline board)

In any row of the accepted-only A/B comparison index, choose **Save complete A/B evidence (ZIP)**. This is one deterministic uncompressed eight-file archive: two original verified CPU PNGs, both normalized importable recipes, both complete FW-012 provenance receipts, the exact pair comparison JSON and the full changed-pixel CSV. Member bytes match the individual source downloads. Crops are not silently world-aligned. The page remains script-free, strict-CSP, offline, accepted-only; there is no new raster, gallery, renderer or admission decision.

Node tests independently parse and CRC-check all six archives against original sources. Chrome/Firefox WebDriver tests keyboard activation and an actual saved ZIP from the offline file, with screenshot evidence. Physical Windows owner acceptance remains a separate gate.

### Selected-work bundle from the live gallery study

After **Render visual index (4 CPU proofs)**, open **Study accepted works / compare**. Browse to a work (B when A is pinned) and choose **Save selected work bundle (ZIP)**. The download contains the same three files as that work's ZIP in the offline board: unchanged FW-012 canonical CPU PNG, normalized importable `.fwrecipe.json`, and full `.fwprovenance.json` recording the exact tick/crop and decoded RGBA8 identity. It avoids saving the entire offline board just to transport one selected work; no new gallery, renderer or editor is involved.

The live action requires the current verified visual-index blob-URL lease, retrieves the exact retained PNG and receipt bytes without `fetch(blob:)`, rechecks the offline-board provenance/recipe contract and packages with the same ZIP/STORE writer. Pinned A and the editor remain unchanged. Cancelled, rebuilt, forged or mismatched sources are rejected. The source-only regression compares each of the four complete ZIP byte streams against the offline board; Firefox and Chrome WebDriver attempt actual keyboard ZIP downloads and verify their persisted bytes. Physical owner acceptance remains separate.
