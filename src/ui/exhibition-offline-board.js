import { decodePngRgba, rawRgbaHash } from '../export/index.js';
import { parseRecipe, recipeHash, serializeRecipe } from '../recipe/index.js';
import { exhibitionEntries } from './exhibition-catalog.js';
import { verifyStudyPng, summarizeDifferingStudyPixels } from './exhibition-pixel-probe.js';
import { createStoredZip } from './exhibition-work-bundle.js';

export const OFFLINE_BOARD_VERSION = 'fw-exhibition-offline-board-v1';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function base64Bytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Canonical PNG bytes are required.');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function base64Utf8(text) {
  return base64Bytes(new TextEncoder().encode(text));
}

function sameCrop(a, b) {
  return a?.widthPx === b?.widthPx && a?.heightPx === b?.heightPx &&
    a?.unitsPerPixelQ16 === b?.unitsPerPixelQ16 &&
    a?.center?.chunkX === b?.center?.chunkX &&
    a?.center?.chunkY === b?.center?.chunkY &&
    a?.center?.localX === b?.center?.localX &&
    a?.center?.localY === b?.center?.localY;
}

// Preserve every changed pixel of the already-verified CPU rasters in
// top-left image-local coordinates. These rows are diagnostics, not artwork.
// No colour conversion, crop registration or new image representation.
function exactPairPixelChanges(a, b) {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const changes = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ai = (y * a.width + x) * 4;
      const bi = (y * b.width + x) * 4;
      const left = Array.from(a.rgba.subarray(ai, ai + 4));
      const right = Array.from(b.rgba.subarray(bi, bi + 4));
      const delta = right.map((v, ch) => v - left[ch]);
      if (delta.some(Boolean)) changes.push({ x, y, left, right, delta });
    }
  }
  return changes;
}

// All evidence must derive from the accepted, explicit-tick CPU export.
// No frame buffer, screenshot, synthetic thumbnail, imported artwork or proxy.
// Reused by the live selected-work export: the one accepted CPU receipt
// verifier must govern both single-work and four-work handoff paths.
export function verifyOfflineExhibitionTile(entry, tile) {
  if (!tile || tile.id !== entry.id || tile.name !== entry.name ||
      tile.seed !== entry.seed || tile.recipeHash !== entry.recipeHash ||
      tile.targetTick !== entry.targetTick ||
      !/^[0-9a-f]{16}$/.test(tile.rawRgbaHash ?? '')) {
    throw new Error('Offline board rejected a missing or mismatched accepted proof.');
  }
  const decoded = decodePngRgba(tile.png);
  if (decoded.widthPx !== entry.exportCrop.widthPx ||
      decoded.heightPx !== entry.exportCrop.heightPx ||
      tile.widthPx !== decoded.widthPx || tile.heightPx !== decoded.heightPx ||
      rawRgbaHash(decoded.rgba) !== tile.rawRgbaHash) {
    throw new Error('Offline board rejected invalid canonical PNG pixels or crop.');
  }
  if (typeof tile.provenanceJson !== 'string') throw new Error('Offline board requires complete export provenance.');
  const receipt = JSON.parse(tile.provenanceJson);
  if (receipt.version !== 'fw-export-provenance-v1' ||
      receipt.exportVersion !== 'fw-canonical-export-v1' ||
      receipt.rasterVersion !== 'fw-canonical-raster-v1' ||
      receipt.pixelFormat !== 'rgba8' ||
      receipt.recipeHash !== entry.recipeHash || receipt.seed !== entry.seed ||
      receipt.targetTick !== entry.targetTick ||
      receipt.rawRgbaHash !== tile.rawRgbaHash ||
      !sameCrop(receipt.crop, entry.exportCrop) ||
      recipeHash(receipt.recipe) !== entry.recipeHash) {
    throw new Error('Offline board rejected mismatched canonical provenance or recipe.');
  }
  return receipt;
}

export function buildOfflineExhibitionBoard(tiles) {
  const entries = exhibitionEntries();
  if (!Array.isArray(tiles) || tiles.length !== entries.length) {
    throw new Error('Offline board requires all four accepted CPU proofs from one complete generation.');
  }
  const byId = new Map();
  for (const tile of tiles) {
    if (!tile || byId.has(tile.id)) throw new Error('Offline board rejected missing or duplicate proof identity.');
    byId.set(tile.id, tile);
  }
  const collectionFiles = [];
  // Reuse the verified source triplets for each exact A/B handoff.
  const sourceFilesById = new Map();
  const cards = entries.map((entry, index) => {
    const tile = byId.get(entry.id);
    const receipt = verifyOfflineExhibitionTile(entry, tile);
    const recipeJson = serializeRecipe(receipt.recipe);
    if (recipeHash(parseRecipe(recipeJson)) !== entry.recipeHash) {
      throw new Error('Offline board refused a non-importable accepted recipe.');
    }
    const recipeFile = 'fieldweaver-' + entry.id + '-' + entry.recipeHash + '.fwrecipe.json';
    const receiptFile = 'fieldweaver-' + entry.id + '-' + tile.rawRgbaHash + '.fwprovenance.json';
    const pngFile = 'fieldweaver-' + entry.id + '-' + tile.rawRgbaHash + '.canonical.png';
    const bundleFile = 'fieldweaver-' + entry.id + '-' + tile.rawRgbaHash + '.fwpack.zip';
    const exactFiles = [
      { name: pngFile, bytes: tile.png },
      { name: recipeFile, bytes: new TextEncoder().encode(recipeJson) },
      { name: receiptFile, bytes: new TextEncoder().encode(tile.provenanceJson) }
    ];
    collectionFiles.push(...exactFiles);
    sourceFilesById.set(entry.id, exactFiles);
    const bundleBytes = createStoredZip(exactFiles);
    const canonicalPng = base64Bytes(tile.png);
    const workBundle = base64Bytes(bundleBytes);
    const crop = entry.exportCrop;
    const cropText = crop.widthPx + '×' + crop.heightPx +
      ' / Q16 ' + crop.unitsPerPixelQ16 +
      ' / chunk ' + crop.center.chunkX + ',' + crop.center.chunkY +
      ' / local ' + crop.center.localX + ',' + crop.center.localY;
    const lineage = entry.lineage?.parentRecipeHash
      ? 'Parent ' + entry.lineage.parentRecipeHash : 'Accepted original';
    return '<article id="work-' + escapeHtml(entry.id) + '" class="work">' +
      '<div class="work-index">' + String(index + 1).padStart(2, '0') + ' / 04 · CANONICAL CPU PROOF</div>' +
      '<h2>' + escapeHtml(entry.name) + '</h2>' +
      '<figure><img width="' + tile.widthPx + '" height="' + tile.heightPx +
      '" alt="' + escapeHtml('Canonical software-raster output of ' + entry.name + ' at tick ' + entry.targetTick) +
      '" src="data:image/png;base64,' + canonicalPng + '">' +
      '<figcaption>Original ' + tile.widthPx + '×' + tile.heightPx +
      ' pixels, nearest-neighbour presentation only</figcaption></figure>' +
      '<dl><dt>Root seed</dt><dd>' + entry.seed +
      '</dd><dt>Target tick</dt><dd>' + entry.targetTick +
      '</dd><dt>Recipe</dt><dd><code>' + escapeHtml(entry.recipeHash) +
      '</code></dd><dt>Raw RGBA8</dt><dd><code>' + escapeHtml(tile.rawRgbaHash) +
      '</code></dd><dt>Crop</dt><dd>' + escapeHtml(cropText) +
      '</dd><dt>Lineage</dt><dd>' + escapeHtml(lineage) +
      '</dd></dl><p class="work-actions">' +
      '<a download="' + escapeHtml(recipeFile) + '" href="data:application/json;base64,' +
      base64Utf8(recipeJson) + '">Save importable recipe</a>' +
      '<a download="' + escapeHtml(receiptFile) + '" href="data:application/json;base64,' +
      base64Utf8(tile.provenanceJson) + '">Save full provenance</a>' +
      '<a download="' + escapeHtml(pngFile) + '" href="data:image/png;base64,' +
      canonicalPng + '">Save canonical PNG</a>' +
      '<a download="' + escapeHtml(bundleFile) + '" href="data:application/zip;base64,' +
      workBundle + '">Save complete work bundle (ZIP)</a>' +
      '</p><details><summary>Inspect complete provenance and loadable recipe JSON</summary>' +
      '<pre>' + escapeHtml(tile.provenanceJson) + '</pre></details></article>';
  });
  // This collection is produced only after all four complete accepted proofs
  // passed verification. No proposed gallery work or generated substitute enters
  // the archive; its twelve flat members are the exact individual downloads.
  const collectionFile = 'fieldweaver-accepted-canonical-collection-v1.zip';
  const collectionZip = base64Bytes(createStoredZip(collectionFiles));
  // The accepted offline board is also a literal A/B comparison record.
  // Re-decode source PNGs after receipt validation; no screenshots, resampling,
  // external images or assumptions that different crops are world-aligned.
  const verifiedRaster = new Map(entries.map((entry) => {
    const tile = byId.get(entry.id);
    return [entry.id, verifyStudyPng(tile.png, entry.exportCrop.widthPx,
      entry.exportCrop.heightPx, tile.rawRgbaHash)];
  }));
  // Exact optional pair previews reuse only accepted, verified original PNGs.
  // CSS data: images preserve the offline script-free/no-network contract.
  const pairImageData = new Map(entries.map((entry) =>
    [entry.id, base64Bytes(byId.get(entry.id).png)]));
  const pairRows = [];
  for (let a = 0; a < entries.length; a += 1) {
    for (let b = a + 1; b < entries.length; b += 1) {
      const first = entries[a], second = entries[b];
      const stats = summarizeDifferingStudyPixels(
        verifiedRaster.get(first.id), verifiedRaster.get(second.id));
      const bounds = stats.bounds
        ? '(' + stats.bounds.left + ',' + stats.bounds.top + ')–(' +
          stats.bounds.right + ',' + stats.bounds.bottom + ')'
        : 'None';
      const authoredCropMatches = sameCrop(first.exportCrop, second.exportCrop);
      const alignment = authoredCropMatches
        ? 'Same authored crop' : 'IMAGE-LOCAL ONLY / NOT world-aligned';
      // Portable evidence for the exact two accepted source identities. This
      // records literal decoded RGBA8 overlap, not perceptual similarity or
      // an inferred world-space registration.
      const comparisonReceipt = {
        version: 'fw-exhibition-ab-comparison-v1',
        coordinateSpace: 'image-local-top-left',
        alignment: authoredCropMatches ? 'same-authored-crop' : 'image-local-only-not-world-aligned',
        a: {
          id: first.id, name: first.name, recipeHash: first.recipeHash,
          rawRgbaHash: byId.get(first.id).rawRgbaHash, seed: first.seed,
          targetTick: first.targetTick, crop: first.exportCrop
        },
        b: {
          id: second.id, name: second.name, recipeHash: second.recipeHash,
          rawRgbaHash: byId.get(second.id).rawRgbaHash, seed: second.seed,
          targetTick: second.targetTick, crop: second.exportCrop
        },
        overlap: {
          widthPx: stats.width, heightPx: stats.height,
          pixels: stats.overlapPixels, differentPixels: stats.differentPixels,
          boundsInclusive: stats.bounds,
          maxAbsDeltaRgba8: stats.channelMaxAbsDelta
        }
      };
      const comparisonFile = 'fieldweaver-ab-' + first.id + '-vs-' + second.id +
        '-' + byId.get(first.id).rawRgbaHash + '-' +
        byId.get(second.id).rawRgbaHash + '.fwcompare.json';
      // The receipt's aggregate statistics and the independently enumerated
      // literal changed-pixel ledger must agree before anything is offered.
      const changes = exactPairPixelChanges(verifiedRaster.get(first.id), verifiedRaster.get(second.id));
      if (changes.length !== stats.differentPixels) {
        throw new Error('Offline A/B changed-pixel ledger disagrees with decoded CPU summary.');
      }
      const ledgerFile = 'fieldweaver-ab-' + first.id + '-vs-' + second.id +
        '-' + byId.get(first.id).rawRgbaHash + '-' +
        byId.get(second.id).rawRgbaHash + '.fwpixels.csv';
      const ledgerHeader = 'x,y,a_r,a_g,a_b,a_a,b_r,b_g,b_b,b_a,delta_r,delta_g,delta_b,delta_a';
      const ledgerCsv = [ledgerHeader, ...changes.map(change => [
        change.x, change.y, ...change.left, ...change.right, ...change.delta
      ].join(','))].join('\n') + '\n';
      // One portable A/B review handoff: both unchanged canonical work
      // triplets, exact comparison receipt and complete changed-pixel ledger.
      const pairBundleFile = 'fieldweaver-ab-' + first.id + '-vs-' + second.id +
        '-' + byId.get(first.id).rawRgbaHash + '-' +
        byId.get(second.id).rawRgbaHash + '.fwabpack.zip';
      const pairBundle = base64Bytes(createStoredZip([
        ...sourceFilesById.get(first.id), ...sourceFilesById.get(second.id),
        { name: comparisonFile,
          bytes: new TextEncoder().encode(JSON.stringify(comparisonReceipt, null, 2) + '\n') },
        { name: ledgerFile, bytes: new TextEncoder().encode(ledgerCsv) }
      ]));
      const pixelDisclosure = '<details class="pair-pixels" data-pair-a="' +
        escapeHtml(first.id) + '" data-pair-b="' + escapeHtml(second.id) +
        '" data-count="' + changes.length + '">' +
        '<summary>Inspect exact changed pixels (' + changes.length + ')</summary>' +
        '<p>Every changed pixel in top-left image-local row-major order. ' +
        escapeHtml(alignment) + '. Signed delta is B−A; no world-space registration.</p>' +
        '<div class="pair-pixel-scroll" tabindex="0" role="region" ' +
        'aria-label="Scrollable exact changed-pixel table"><table>' +
        '<thead><tr><th scope="col">X,Y</th><th scope="col">A RGBA8</th>' +
        '<th scope="col">B RGBA8</th><th scope="col">B−A RGBA8</th></tr></thead><tbody>' +
        changes.map(change => '<tr data-pixel-x="' + change.x +
          '" data-pixel-y="' + change.y + '"><th scope="row">' +
          change.x + ',' + change.y + '</th><td>' + change.left.join(', ') +
          '</td><td>' + change.right.join(', ') + '</td><td>' +
          change.delta.join(', ') + '</td></tr>').join('') +
        '</tbody></table></div></details>';
      pairRows.push('<tr data-pair-a="' + escapeHtml(first.id) +
        '" data-pair-b="' + escapeHtml(second.id) +
        '" data-differences="' + stats.differentPixels +
        '" data-overlap="' + stats.overlapPixels + '">' +
        '<th scope="row"><a href="#work-' + escapeHtml(first.id) + '">' +
        escapeHtml(first.name) + '</a> / <a href="#work-' + escapeHtml(second.id) +
        '">' + escapeHtml(second.name) + '</a>' +
        '<details class="pair-preview" data-pair-a="' + escapeHtml(first.id) +
        '" data-pair-b="' + escapeHtml(second.id) + '">' +
        '<summary>View exact A/B images</summary>' +
        '<p>Original accepted CPU PNGs displayed without resampling. ' +
        escapeHtml(alignment) + '; pixel coordinates are image-local. ' +
        'This is not a synthetic difference image.</p>' +
        '<div class="pair-images">' +
        '<figure><div class="pair-raster" role="img" data-work-id="' + escapeHtml(first.id) +
        '" data-canonical-hash="' + escapeHtml(byId.get(first.id).rawRgbaHash) +
        '" aria-label="' + escapeHtml('A: original canonical CPU PNG of ' + first.name) +
        '" style="background-image:url(data:image/png;base64,' +
        pairImageData.get(first.id) + ')"></div><figcaption>A · ' +
        escapeHtml(first.name) + ' · <code>' +
        escapeHtml(byId.get(first.id).rawRgbaHash) + '</code></figcaption></figure>' +
        '<figure><div class="pair-raster" role="img" data-work-id="' + escapeHtml(second.id) +
        '" data-canonical-hash="' + escapeHtml(byId.get(second.id).rawRgbaHash) +
        '" aria-label="' + escapeHtml('B: original canonical CPU PNG of ' + second.name) +
        '" style="background-image:url(data:image/png;base64,' +
        pairImageData.get(second.id) + ')"></div><figcaption>B · ' +
        escapeHtml(second.name) + ' · <code>' +
        escapeHtml(byId.get(second.id).rawRgbaHash) + '</code></figcaption></figure>' +
        '</div></details>' + pixelDisclosure + '</th>' +
        '<td>' + stats.width + '×' + stats.height + '</td>' +
        '<td>' + stats.differentPixels + ' / ' + stats.overlapPixels + '</td>' +
        '<td>' + bounds + '</td>' +
        '<td>' + stats.channelMaxAbsDelta.join(', ') + '</td>' +
        '<td>' + alignment + '</td>' +
        '<td><a download="' + escapeHtml(comparisonFile) +
        '" href="data:application/json;base64,' +
        base64Utf8(JSON.stringify(comparisonReceipt, null, 2) + '\n') +
        '">Save A/B receipt (JSON)</a> ' +
        '<a download="' + escapeHtml(ledgerFile) +
        '" href="data:text/csv;base64,' + base64Utf8(ledgerCsv) +
        '">Save exact pixel ledger (CSV)</a> ' +
        '<a download="' + escapeHtml(pairBundleFile) +
        '" href="data:application/zip;base64,' + pairBundle +
        '">Save complete A/B evidence (ZIP)</a></td></tr>');
    }
  }
  const comparisonSection = '<section id="comparison-index" class="comparison-index" ' +
    'aria-labelledby="comparison-heading"><h2 id="comparison-heading">Exact A/B comparison index</h2>' +
    '<p>Every accepted pair is compared using original decoded CPU RGBA8 bytes ' +
    'in its shared image-local rectangle. Changed means any RGBA channel differs; ' +
    'bounds are inclusive. Different authored crops are not registered in world space. ' +
    'These are not perceptual similarity scores. Expand each pair to see exact canonical images and inspect every changed pixel; save a lossless CSV ledger.</p>' +
    '<div id="comparison-scroll" class="comparison-scroll" tabindex="0" role="region" ' +
    'aria-label="Scrollable A/B comparison table"><table><thead><tr>' +
    '<th scope="col">Accepted works</th><th scope="col">Overlap (pixels)</th>' +
    '<th scope="col">Changed RGBA8 pixels</th><th scope="col">Change bounds</th>' +
    '<th scope="col">Maximum |ΔRGBA8| R, G, B, A</th><th scope="col">Coordinate meaning</th>' +
    '<th scope="col">Evidence</th>' +
    '</tr></thead><tbody>' + pairRows.join('') + '</tbody></table></div></section>';
  const nav = entries.map((entry, index) =>
    '<a href="#work-' + escapeHtml(entry.id) + '">' +
    String(index + 1).padStart(2, '0') + ' ' + escapeHtml(entry.name) + '</a>').join('');
  const html = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="referrer" content="no-referrer">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src data:; style-src &#39;unsafe-inline&#39;; object-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;; connect-src &#39;none&#39;">' +
    '<title>FIELDWEAVER / Accepted canonical proofs</title>' +
    '<style>*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#10140f;color:#e7e9d4;font:15px/1.55 system-ui,sans-serif}a{color:#b9e2c2}a:focus-visible,summary:focus-visible{outline:3px solid #e4b665;outline-offset:3px}.wrap{max-width:1420px;margin:auto;padding:clamp(16px,4vw,52px)}header{border-bottom:2px solid #738b6e}small,.overline,.work-index{font:700 12px/1.5 ui-monospace,monospace;letter-spacing:.12em;color:#b4c6a7}h1{font:600 clamp(30px,5vw,60px)/1.1 Georgia,serif;margin:.3em 0}header p{max-width:80ch}nav{display:flex;flex-wrap:wrap;gap:10px;margin:24px 0}nav a{border:1px solid #6e856b;padding:8px 12px;text-decoration:none}nav a:hover{background:#283829}.gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.work{background:#1b241b;border:1px solid #6c8066;padding:clamp(14px,2vw,26px);min-width:0}.work h2{font:500 clamp(23px,3vw,35px)/1.2 Georgia,serif;margin:.3em 0 .8em}.work figure{margin:0}.work img{display:block;width:100%;height:auto;aspect-ratio:3/2;image-rendering:pixelated;object-fit:contain;background:#090b08;border:1px solid #5c6d55}.work figcaption{color:#b7bda8;font:12px ui-monospace,monospace;margin:7px 0 15px}.work dl{display:grid;grid-template-columns:110px minmax(0,1fr);gap:6px 12px;margin:0 0 20px}.work dt{color:#b0c19c}.work dd{margin:0;min-width:0;overflow-wrap:anywhere}.work code{font:12px ui-monospace,monospace}.work-actions{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 16px}.work-actions a{display:inline-block;border:1px solid #6e856b;padding:7px 10px;text-decoration:none}.work-actions a:hover{background:#283829}.comparison-index{margin-top:26px;border-top:2px solid #738b6e;padding-top:16px}.comparison-index h2{font:500 30px Georgia,serif;margin:8px 0}.comparison-scroll{overflow-x:auto}.comparison-scroll:focus-visible{outline:3px solid #e4b665;outline-offset:3px}.comparison-index table{border-collapse:collapse;width:100%;min-width:770px}.comparison-index th,.comparison-index td{padding:9px 10px;border:1px solid #6c8066;text-align:left;vertical-align:top}.comparison-index thead{background:#263426}.comparison-index th{font-weight:600}.pair-preview{margin-top:8px}.pair-preview[open]{min-width:520px}.pair-preview summary{cursor:pointer;color:#cde3bc;font-weight:500}.pair-preview p{font:13px/1.5 system-ui,sans-serif;max-width:60ch}.pair-images{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:10px 0}.pair-images figure{margin:0;min-width:0}.pair-raster{width:100%;aspect-ratio:3/2;border:1px solid #6c8066;background-color:#090b08;background-position:center;background-repeat:no-repeat;background-size:contain;image-rendering:pixelated}.pair-images figcaption{font:12px/1.5 ui-monospace,monospace;color:#b7bda8;overflow-wrap:anywhere}.pair-images code{font:11px ui-monospace,monospace}.pair-pixels{margin-top:8px}.pair-pixels summary{cursor:pointer;color:#cde3bc;font-weight:500}.pair-pixels p{font:13px/1.5 system-ui,sans-serif;max-width:60ch}.pair-pixel-scroll{max-width:min(68vw,700px);max-height:300px;overflow:auto;margin:10px 0}.pair-pixel-scroll table{min-width:460px;width:100%;font:12px/1.4 ui-monospace,monospace}.pair-pixel-scroll:focus-visible{outline:3px solid #e4b665;outline-offset:3px}@media(max-width:770px){.pair-preview[open]{min-width:270px}.pair-images{grid-template-columns:minmax(0,1fr)}}.work details{border-top:1px solid #6c8066;padding-top:12px}.work summary{cursor:pointer;color:#cde3bc}.work pre{font:11px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto;background:#10140f;padding:12px}footer{border-top:2px solid #738b6e;margin-top:30px;padding-top:18px;color:#b7bda8}@media(max-width:770px){.gallery{grid-template-columns:1fr}.work dl{grid-template-columns:85px minmax(0,1fr)}}@media print{body{background:#fff;color:#111}.work{break-inside:avoid;background:#fff;color:#111}.work dt,small,.overline,.work-index{color:#333}.work img{border:1px solid #555}.work figcaption,footer{color:#333}nav,details,.work-actions{display:none}.gallery{grid-template-columns:repeat(2,minmax(0,1fr))}}</style>' +
    '</head><body><div class="wrap"><header><div class="overline">FIELDWEAVER / EXHIBITION RECORD / ' +
    OFFLINE_BOARD_VERSION + '</div><h1>Accepted canonical proofs</h1>' +
    '<p>Four independently replayed FW-012 CPU software-raster images. Every image, source recipe, seed, tick, crop and decoded RGBA8 identity was verified before export. No WebGL screenshots, unaccepted artworks or visual-similarity estimates.</p>' +
    '<p><small>STATIC / SELF-CONTAINED / OFFLINE / NO SCRIPTS OR REMOTE ASSETS</small></p></header>' +
    '<nav aria-label="Jump to accepted work">' + nav + '<a href="#comparison-index">A/B comparison index</a></nav>' +
    '<p class="work-actions collection-actions"><a download="' + collectionFile +
    '" href="data:application/zip;base64,' + collectionZip +
    '">Save all accepted works (ZIP)</a> <small>12 original files / 4 verified works / offline</small></p>' +
    '<main class="gallery">' + cards.join('') + '</main>' + comparisonSection +
    '<footer>Each optional A/B disclosure shows two unchanged CPU PNGs and a separately downloadable exact changed-pixel CSV ledger without registering different crops; the complete A/B ZIP carries both original works, the pair receipt and that exact CSV together; each receipt records verified accepted identities and literal image-local RGBA8 difference statistics. No world-space alignment is inferred. Each image is the original 96×64 canonical raster, enlarged for inspection. PNG bytes are not the pixel identity; raw decoded RGBA8 hashes are. Save each work’s unchanged canonical PNG, importable recipe and full provenance separately, as one ZIP per work, or as a twelve-file accepted collection ZIP directly from this file; target tick and crop are in the provenance rather than the recipe. Browser downloads still require local file-manager confirmation. This board is a review record, not an artistic approval.</footer>' +
    '</div></body></html>\n';
  return Object.freeze({ version: OFFLINE_BOARD_VERSION, count: entries.length, html });
}
