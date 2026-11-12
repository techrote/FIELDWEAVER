import { exhibitionEntries } from './exhibition-catalog.js';
import { verifyStudyPng, sampleStudyPixel, studyImageClickPixel, nextVisibleStudyPixel, nextDifferingStudyPixel, previousDifferingStudyPixel, summarizeDifferingStudyPixels, compareStudyPixelChannels, sameStudyCrop, buildStudyPixelReceipt } from './exhibition-pixel-probe.js';
import { getAcceptedVisualIndexPng, getAcceptedVisualIndexProvenance } from './exhibition-visual-index.js';
import { verifyOfflineExhibitionTile } from './exhibition-offline-board.js';
import { buildAcceptedRecipeHandoff } from './exhibition-recipe-handoff.js';

// Read-only exhibition navigation. The gallery's existing visual-index
// verifier owns CPU replay, PNG decoding, provenance and image URL lifetime.
export function studyNextId(ids, currentId, offset) {
  if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== 'string' || !id) || !Number.isInteger(offset)) {
    throw new TypeError('Invalid accepted gallery navigation.');
  }
  const index = ids.indexOf(currentId);
  if (index === -1) throw new RangeError('Unknown accepted gallery work.');
  return ids[((index + offset) % ids.length + ids.length) % ids.length];
}


// Keyboard navigation targets exact source pixels, never screen-space or WebGL.
export function studyPixelCursor(width, height, x, y, key, coarse = false) {
  if (![width, height, x, y].every(Number.isInteger) || width < 1 || height < 1 ||
      x < 0 || x >= width || y < 0 || y >= height || typeof coarse !== 'boolean') {
    throw new RangeError('Invalid canonical pixel cursor geometry.');
  }
  const vectors = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    ArrowUp: [0, -1], ArrowDown: [0, 1]
  };
  const vector = vectors[key];
  if (!vector) return null;
  const step = coarse ? 10 : 1;
  return Object.freeze({
    x: Math.max(0, Math.min(width - 1, x + vector[0] * step)),
    y: Math.max(0, Math.min(height - 1, y + vector[1] * step))
  });
}

export function studyArtworkLabel(entry, rawRgbaHash) {
  if (!entry || typeof entry.id !== 'string' || !/^[0-9a-f]{16}$/.test(rawRgbaHash) ||
      !entry.exportCrop?.center || !Number.isInteger(entry.targetTick)) {
    throw new TypeError('A verified accepted CPU artwork is required.');
  }
  const crop = entry.exportCrop;
  return Object.freeze({
    id: entry.id,
    title: entry.name,
    alt: 'Canonical CPU software-raster image of ' + entry.name + ' at tick ' + entry.targetTick,
    details: 'Seed ' + entry.seed + ' · tick ' + entry.targetTick +
      ' · crop ' + crop.widthPx + '×' + crop.heightPx +
      ' · Q16 units/px ' + crop.unitsPerPixelQ16 +
      ' · centre chunk ' + crop.center.chunkX + ',' + crop.center.chunkY +
      ' · recipe ' + entry.recipeHash + ' · decoded RGBA8 ' + rawRgbaHash +
      ' · ' + (entry.lineage ? 'parent ' + entry.lineage.parentRecipeHash : 'original accepted preset')
  });
}

function make(tag, options = {}, text = '') {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) node.setAttribute(key, value);
  node.textContent = text;
  return node;
}

// A full-window, keyboard-operable study reel of the *already verified* four
// CPU proofs. Does not generate thumbnails, import works or touch recipes.
export function mountExhibitionStudy(panel) {
  if (!(panel instanceof HTMLElement)) throw new TypeError('An exhibition panel is required.');
  if (panel.dataset.exhibitionStudyReady === 'true') return;
  const grid = panel.querySelector('#exhibition-grid');
  const controls = panel.querySelector('.exhibition-index-controls');
  const indexStatus = panel.querySelector('#exhibition-index-status');
  const indexRender = panel.querySelector('#exhibition-index-render');
  const indexCancel = panel.querySelector('#exhibition-index-cancel');
  const saveBoard = panel.querySelector('#exhibition-board-save');
  const boardStatus = panel.querySelector('#exhibition-board-status');
  const select = panel.querySelector('#preset-select');
  if (!grid || !controls || !indexStatus || !indexRender || !indexCancel ||
      !saveBoard || !boardStatus || !select) {
    throw new Error('The accepted canonical visual index must mount first.');
  }
  const entries = exhibitionEntries();
  const ids = entries.map((entry) => entry.id);
  const lookup = new Map(entries.map((entry) => [entry.id, entry]));
  const launch = make('button', { id: 'exhibition-study-launch', type: 'button', class: 'button exhibition-study-launch' },
    'Study accepted works / compare');
  launch.disabled = true;
  controls.append(launch);

  const dialog = make('dialog', { id: 'exhibition-study-dialog', class: 'exhibition-study-dialog',
    'aria-labelledby': 'exhibition-study-title' });
  const header = make('div', { class: 'exhibition-study-header' });
  const title = make('h2', { id: 'exhibition-study-title' }, 'Canonical gallery study');
  const closeButton = make('button', { id: 'exhibition-study-close', type: 'button', class: 'button' }, 'Close');
  header.append(title, closeButton);
  const toolbar = make('div', { class: 'exhibition-study-toolbar' });
  const back = make('button', { id: 'exhibition-study-prev', type: 'button', class: 'button' }, 'Previous');
  const forward = make('button', { id: 'exhibition-study-next', type: 'button', class: 'button' }, 'Next');
  const pin = make('button', { id: 'exhibition-study-pin', type: 'button', class: 'button' }, 'Pin current as A');
  const unpin = make('button', { id: 'exhibition-study-unpin', type: 'button', class: 'button' }, 'Clear A');
  const load = make('button', { id: 'exhibition-study-load', type: 'button', class: 'button' }, 'Load selected into editor');
  const inspect = make('button', { id: 'exhibition-study-pixel-toggle', type: 'button',
  class: 'button', 'aria-expanded': 'false', 'aria-controls': 'exhibition-study-pixel-desk' }, 'Inspect exact pixels');
  const exportPng = make('button', { id: 'exhibition-study-save-png', type: 'button', class: 'button' },
    'Save selected CPU PNG');
  const exportRecipe = make('button', { id: 'exhibition-study-save-recipe', type: 'button', class: 'button' },
    'Save selected recipe');
  const exportProvenance = make('button', { id: 'exhibition-study-save-provenance', type: 'button', class: 'button' },
    'Save selected provenance');
  const exportBoard = make('button', { id: 'exhibition-study-save-board', type: 'button', class: 'button' },
    'Save accepted board (HTML)');
  toolbar.append(back, forward, pin, unpin, load, inspect, exportPng, exportRecipe, exportProvenance, exportBoard);
  const description = make('p', { class: 'workspace-note', id: 'exhibition-study-help' },
    'Left/Right: browse when outside images · P: pin A · Tab to image, Enter: inspect centre, arrows: move one source pixel, Shift+arrows: move ten · Escape: close. Canonical CPU only.');
  const gallery = make('div', { class: 'exhibition-study-frames', role: 'group',
    'aria-label': 'Accepted canonical artwork images' });
  function frame(letter) {
    const box = make('figure', { class: 'exhibition-study-frame' });
    const heading = make('h3');
    const img = make('img', { alt: '', tabindex: '0', 'aria-describedby': 'exhibition-study-help' });
    const caption = make('figcaption', { class: 'workspace-note' });
    box.append(heading, img, caption);
    gallery.append(box);
    return { box, heading, img, caption, letter };
  }
  const left = frame('A'), right = frame('B');
  const desk = make('section', { id: 'exhibition-study-pixel-desk', class: 'exhibition-study-pixel-desk',
    'aria-label': 'Decoded canonical pixel inspection' });
  desk.hidden = true;
  const help = make('p', { class: 'workspace-note' },
    'Click an image, focus it and use arrow keys (Shift: 10 pixels), or enter a column/row. Values are exact decoded CPU pixels, origin top-left. With A pinned, both RGBA8 values and B−A channel deltas use the same image-local pixel; authored crops may differ.');
  const fields = make('div', { class: 'exhibition-study-pixel-controls' });
  const sourceLabel = make('label', {}, 'Image ');
  const source = make('select', { id: 'exhibition-study-pixel-source' });
  source.append(make('option', { value: 'A' }, 'A'), make('option', { value: 'B' }, 'B'));
  sourceLabel.append(source);
  const xLabel = make('label', {}, 'Column ');
  const x = make('input', { id: 'exhibition-study-pixel-x', type: 'number', min: '0', step: '1' });
  xLabel.append(x);
  const yLabel = make('label', {}, 'Row ');
  const y = make('input', { id: 'exhibition-study-pixel-y', type: 'number', min: '0', step: '1' });
  yLabel.append(y);
  const nextMark = make('button', { id: 'exhibition-study-pixel-next', class: 'button',
    type: 'button' }, 'Next visible mark');
  const nextDifference = make('button', { id: 'exhibition-study-pixel-difference',
    class: 'button', type: 'button' }, 'Next A/B difference');
  nextDifference.disabled = true;
  const previousDifference = make('button', { id: 'exhibition-study-pixel-difference-prev',
    class: 'button', type: 'button' }, 'Previous A/B difference');
  previousDifference.disabled = true;
  const summarizeDifference = make('button', { id: 'exhibition-study-pixel-summary',
    class: 'button', type: 'button' }, 'Summarize A/B overlap');
  summarizeDifference.disabled = true;
  const savePixel = make('button', { id: 'exhibition-study-pixel-save', class: 'button',
    type: 'button' }, 'Save exact pixel receipt (JSON)');
  fields.append(sourceLabel, xLabel, yLabel, nextMark, previousDifference, nextDifference, summarizeDifference, savePixel);
  const reading = make('output', { id: 'exhibition-study-pixel-reading',
    class: 'workspace-note', 'aria-live': 'polite' }, 'Choose a pixel.');
  reading.hidden = true;
  const compareReading = make('output', { id: 'exhibition-study-pixel-ab',
    class: 'workspace-note', 'aria-live': 'polite' });
  compareReading.hidden = true;
  const compareSummary = make('output', { id: 'exhibition-study-pixel-summary-reading',
    class: 'workspace-note', 'aria-live': 'polite' });
  compareSummary.hidden = true;
  const gridPixels = make('div', { id: 'exhibition-study-pixel-neighbours',
    class: 'exhibition-study-pixel-neighbours', role: 'img',
    'aria-label': 'Nine by nine nearest-neighbour display; selected centre outlined' });
  desk.append(help, fields, gridPixels);
  const announce = make('output', { id: 'exhibition-study-status', 'aria-live': 'polite',
    class: 'workspace-note' }, 'No study open.');
  // Keep the exact source-pixel readout visible above large framed works,
  // including when A/B images stack at narrow viewport widths.
  dialog.append(header, toolbar, description, reading, compareReading, compareSummary, gallery, desk, announce);
  document.body.append(dialog);

  let currentId = ids[0];
  let pinnedId = null;
  let pixelOpen = false;
  let pixelToken = 0;
  let lastPixelId = null;
  const pixelCache = new Map();
  const cards = new Map(entries.map((entry) => [entry.id,
    [...grid.querySelectorAll('[data-exhibition-id]')].find((card) => card.dataset.exhibitionId === entry.id)]));
  const images = new Map([...cards].map(([id, card]) => [id, card?.querySelector('.exhibition-index-image')]));
  const snapshot = () => {
    if (!indexStatus.textContent.includes('Visual index ready: ' + ids.length + '/' + ids.length)) return null;
    const result = new Map();
    for (const entry of entries) {
      const card = cards.get(entry.id), image = images.get(entry.id);
      const hash = card?.dataset.canonicalRgbaHash;
      if (!image || image.hidden || !image.complete ||
          image.naturalWidth !== entry.exportCrop.widthPx ||
          image.naturalHeight !== entry.exportCrop.heightPx ||
          !image.currentSrc.startsWith('blob:')) return null;
      let label;
      try { label = studyArtworkLabel(entry, hash); } catch { return null; }
      result.set(entry.id, { label, url: image.currentSrc, hash });
    }
    return result;
  };
  function present(frameNode, record) {
    frameNode.box.hidden = !record;
    if (!record) {
      frameNode.img.removeAttribute('src');
      frameNode.img.alt = '';
      frameNode.caption.textContent = '';
      return;
    }
    frameNode.heading.textContent = frameNode.letter + ' · ' + record.label.title;
    frameNode.img.src = record.url;
    frameNode.img.alt = record.label.alt;
    frameNode.caption.textContent = record.label.details;
  }
  const pixelId = () => source.value === 'B' && pinnedId ? currentId : (pinnedId ?? currentId);
  function clearSummary() {
    compareSummary.textContent = '';
    compareSummary.hidden = true;
  }
  async function updatePixel(resetCoordinates = false, findNextMark = false) {
    if (!pixelOpen || !dialog.open) return;
    const token = ++pixelToken;
    compareReading.hidden = true;
    compareReading.textContent = '';
    const id = pixelId(), record = snapshot()?.get(id), entry = lookup.get(id);
    if (!record) {
      clearSummary();
      reading.textContent = 'Verified CPU image unavailable.';
      gridPixels.replaceChildren();
      return;
    }
    try {
      // Renew the live proof lease on *every* sample, including cache hits.
      // A forged hash/rebuilt proof cannot retain an old decoded readout.
      const currentPng = getAcceptedVisualIndexPng(panel, id, record.url, record.hash);
      let pixels = pixelCache.get(record.url);
      if (!pixels || pixels.hash !== record.hash) {
        // In-memory FW-012 PNG bytes. CSP forbids fetch(blob:).
        pixels = verifyStudyPng(currentPng,
          entry.exportCrop.widthPx, entry.exportCrop.heightPx, record.hash);
        if (token !== pixelToken || !dialog.open) return;
        pixelCache.set(record.url, pixels);
      }
      if (token !== pixelToken || !dialog.open) return;
      if (resetCoordinates || lastPixelId !== id) {
        x.value = String(Math.floor(pixels.width / 2));
        y.value = String(Math.floor(pixels.height / 2));
        lastPixelId = id;
      }
      x.max = String(pixels.width - 1); y.max = String(pixels.height - 1);
      const col = Math.max(0, Math.min(pixels.width - 1, Math.trunc(Number(x.value) || 0)));
      const row = Math.max(0, Math.min(pixels.height - 1, Math.trunc(Number(y.value) || 0)));
      let nextCol = col, nextRow = row;
      if (findNextMark) {
        const next = nextVisibleStudyPixel(pixels, col, row);
        if (next) { nextCol = next.x; nextRow = next.y; }
        else {
          reading.textContent = entry.name + ' has no visible non-background pixels at this accepted crop.';
          gridPixels.replaceChildren();
          return;
        }
      }
      x.value = String(nextCol); y.value = String(nextRow);
      const sample = sampleStudyPixel(pixels, nextCol, nextRow);
      reading.textContent = entry.name + ' · (' + nextCol + ', ' + nextRow + ') · ' + sample.hex +
        ' · RGBA8 ' + sample.rgba.join(', ') + ' · image identity ' + pixels.hash;
      if (pinnedId) {
        // Renew BOTH proof leases, even on a cached pixel or while reading A.
        // The comparison is source-local unless the authored crops coincide.
        const otherId = id === pinnedId ? currentId : pinnedId;
        const peer = snapshot()?.get(otherId), otherEntry = lookup.get(otherId);
        if (!peer || !otherEntry) throw new Error('A/B peer CPU proof is unavailable.');
        const peerPng = getAcceptedVisualIndexPng(panel, otherId, peer.url, peer.hash);
        let peerPixels = pixelCache.get(peer.url);
        if (!peerPixels || peerPixels.hash !== peer.hash) {
          peerPixels = verifyStudyPng(peerPng,
            otherEntry.exportCrop.widthPx, otherEntry.exportCrop.heightPx, peer.hash);
          pixelCache.set(peer.url, peerPixels);
        }
        if (token !== pixelToken || !dialog.open) return;
        if (nextCol >= peerPixels.width || nextRow >= peerPixels.height) {
          compareReading.textContent = 'A/B source-local comparison unavailable at this coordinate: ' +
            'the other image ends before (' + nextCol + ', ' + nextRow + ').';
        } else {
          const aPixels = id === pinnedId ? pixels : peerPixels;
          const bPixels = id === pinnedId ? peerPixels : pixels;
          const compared = compareStudyPixelChannels(aPixels, bPixels, nextCol, nextRow);
          const aligned = sameStudyCrop(lookup.get(pinnedId).exportCrop, lookup.get(currentId).exportCrop);
          compareReading.textContent = 'A ' + lookup.get(pinnedId).name + ': ' +
            compared.a.hex + ' RGBA8 ' + compared.a.rgba.join(', ') +
            ' · B ' + lookup.get(currentId).name + ': ' +
            compared.b.hex + ' RGBA8 ' + compared.b.rgba.join(', ') +
            ' · Δ(B−A) RGBA8 ' + compared.delta.join(', ') +
            ' · ' + (aligned ? 'same authored crop' :
              'IMAGE-LOCAL ONLY: authored crops differ; not a world-aligned comparison');
        }
        compareReading.hidden = false;
      }
      const cells = [];
      for (let dy = -4; dy <= 4; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          const cell = make('span', { class: 'exhibition-study-pixel-cell' + (dx === 0 && dy === 0 ? ' is-centre' : '') });
          const px = nextCol + dx, py = nextRow + dy;
          if (px < 0 || py < 0 || px >= pixels.width || py >= pixels.height) cell.classList.add('is-outside');
          else {
            const color = sampleStudyPixel(pixels, px, py);
            cell.style.backgroundColor = 'rgb(' + color.rgba.slice(0, 3).join(',') + ')';
            cell.title = px + ',' + py + ' ' + color.hex;
          }
          cells.push(cell);
        }
      }
      gridPixels.replaceChildren(...cells);
    } catch (error) {
      if (token !== pixelToken) return;
      reading.textContent = 'Cannot inspect this verified PNG: ' + (error?.message ?? String(error));
      clearSummary();
      gridPixels.replaceChildren();
    }
  }
  function resetPixel() {
    ++pixelToken; pixelCache.clear(); lastPixelId = null; pixelOpen = false;
    dialog.classList.remove('is-pixel-inspection');
    desk.hidden = true; inspect.setAttribute('aria-expanded', 'false'); inspect.textContent = 'Inspect exact pixels';
    gridPixels.replaceChildren(); reading.textContent = 'Choose a pixel.'; reading.hidden = true;
    compareReading.hidden = true; compareReading.textContent = '';
    clearSummary();
  }
  function openPixelDesk() {
    if (pixelOpen) return;
    pixelOpen = true; desk.hidden = false; reading.hidden = false;
    dialog.classList.add('is-pixel-inspection');
    inspect.setAttribute('aria-expanded', 'true');
    inspect.textContent = 'Hide pixel inspection';
  }
  inspect.addEventListener('click', () => {
    if (pixelOpen) { resetPixel(); return; }
    openPixelDesk();
    source.value = pinnedId ? 'B' : 'A';
    void updatePixel(true); x.focus();
  });
  source.addEventListener('change', () => { lastPixelId = null; void updatePixel(true); });
  for (const input of [x, y]) input.addEventListener('input', () => void updatePixel());
  nextMark.addEventListener('click', () => void updatePixel(false, true));
  const navigateDifference = (direction) => {
    if (!pixelOpen || !dialog.open || !pinnedId) return;
    try {
      const records = snapshot();
      if (!records) throw new Error('Rebuild the verified accepted CPU index.');
      const decodeCurrent = (id) => {
        const record = records.get(id), entry = lookup.get(id);
        if (!record || !entry) throw new Error('A/B accepted source is unavailable.');
        // The comparison must renew and re-decode BOTH leases even when the
        // pixel desk already holds cached rasters. CSP forbids fetch(blob:).
        const png = getAcceptedVisualIndexPng(panel, id, record.url, record.hash);
        return verifyStudyPng(png,
          entry.exportCrop.widthPx, entry.exportCrop.heightPx, record.hash);
      };
      const a = decodeCurrent(pinnedId), b = decodeCurrent(currentId);
      const hit = (direction > 0 ? nextDifferingStudyPixel : previousDifferingStudyPixel)(
        a, b, Number(x.value), Number(y.value));
      if (!hit) {
        compareReading.textContent = 'No different decoded RGBA8 pixels in the ' +
          Math.min(a.width, b.width) + '×' + Math.min(a.height, b.height) +
          ' image-local overlap · ' +
          (sameStudyCrop(lookup.get(pinnedId).exportCrop, lookup.get(currentId).exportCrop)
            ? 'same authored crop' : 'authored crops differ; NOT world-aligned');
        compareReading.hidden = false;
        return;
      }
      x.value = String(hit.x); y.value = String(hit.y);
      void updatePixel(); // Ordinary source revalidation and A/B evidence display.
    } catch (error) {
      // A forged or expired peer cannot retain the previous displayed delta.
      ++pixelToken;
      pixelCache.clear();
      reading.textContent = 'Cannot inspect verified A/B images: ' + (error?.message ?? String(error));
      compareReading.textContent = '';
      compareReading.hidden = true;
      clearSummary();
      gridPixels.replaceChildren();
    }
  };
  summarizeDifference.addEventListener('click', () => {
    clearSummary(); // A failure must never preserve a previous A/B result.
    if (!pixelOpen || !dialog.open || !pinnedId) return;
    try {
      const records = snapshot();
      if (!records) throw new Error('Rebuild the verified accepted CPU index.');
      const verified = (id) => {
        const record = records.get(id), entry = lookup.get(id);
        if (!record || !entry) throw new Error('A/B accepted source is unavailable.');
        // Never trust the pixel desk cache: revalidate both live leases and
        // independently decode their actual in-memory canonical PNG bytes.
        const png = getAcceptedVisualIndexPng(panel, id, record.url, record.hash);
        return verifyStudyPng(png,
          entry.exportCrop.widthPx, entry.exportCrop.heightPx, record.hash);
      };
      const summary = summarizeDifferingStudyPixels(verified(pinnedId), verified(currentId));
      const bounds = summary.bounds
        ? '(' + summary.bounds.left + ', ' + summary.bounds.top + ')–(' +
          summary.bounds.right + ', ' + summary.bounds.bottom + ')'
        : 'none';
      const cropLabel = sameStudyCrop(lookup.get(pinnedId).exportCrop, lookup.get(currentId).exportCrop)
        ? 'same authored crop'
        : 'IMAGE-LOCAL ONLY: authored crops differ; NOT world-aligned';
      compareSummary.textContent = 'A/B exact RGBA8 overlap ' + summary.width + '×' + summary.height +
        ' · differing pixels ' + summary.differentPixels + '/' + summary.overlapPixels +
        ' · difference bounds ' + bounds +
        ' · maximum |Δ(B−A)| RGBA8 ' + summary.channelMaxAbsDelta.join(', ') +
        ' · ' + cropLabel;
      compareSummary.hidden = false;
    } catch (error) {
      compareSummary.textContent = 'A/B summary refused: ' + (error?.message ?? String(error));
      compareSummary.hidden = false;
    }
  });
  nextDifference.addEventListener('click', () => navigateDifference(1));
  previousDifference.addEventListener('click', () => navigateDifference(-1));
  for (const [side, frameNode] of [['A', left], ['B', right]]) {
    frameNode.img.title = 'Focus and use Enter or arrow keys to inspect canonical pixels';
    frameNode.img.addEventListener('keydown', (event) => {
      if (!dialog.open || (side === 'B' && !pinnedId) ||
          event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== 'Enter' && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation(); // Arrow keys inside an image move pixels, not gallery works.
      const id = side === 'B' ? currentId : (pinnedId ?? currentId);
      const record = snapshot()?.get(id), entry = lookup.get(id);
      if (!record || !entry) return;
      const width = entry.exportCrop.widthPx, height = entry.exportCrop.heightPx;
      const sameImage = pixelOpen && source.value === side && lastPixelId === id;
      const startX = sameImage ? Math.max(0, Math.min(width - 1, Math.trunc(Number(x.value) || 0))) : Math.floor(width / 2);
      const startY = sameImage ? Math.max(0, Math.min(height - 1, Math.trunc(Number(y.value) || 0))) : Math.floor(height / 2);
      const point = studyPixelCursor(width, height, startX, startY, event.key, event.shiftKey) ??
        { x: startX, y: startY };
      openPixelDesk();
      source.value = side;
      lastPixelId = id;
      x.value = String(point.x); y.value = String(point.y);
      void updatePixel();
    });
    frameNode.img.addEventListener('click', (event) => {
      if (!dialog.open || (side === 'B' && !pinnedId)) return;
      const img = frameNode.img, bounds = img.getBoundingClientRect();
      const entry = lookup.get(side === 'B' ? currentId : (pinnedId ?? currentId));
      const point = studyImageClickPixel({
        left: bounds.left + img.clientLeft, top: bounds.top + img.clientTop,
        width: img.clientWidth, height: img.clientHeight
      }, entry.exportCrop.widthPx, entry.exportCrop.heightPx, event.clientX, event.clientY);
      if (!point) return;
      openPixelDesk();
      source.value = side; lastPixelId = pixelId();
      x.value = String(point.x); y.value = String(point.y);
      void updatePixel();
    });
  }
  function paint() {
    clearSummary(); // The previous A/B source pair is no longer in view.
    const frames = snapshot();
    if (!frames) { close(); return; }
    present(left, frames.get(pinnedId ?? currentId));
    present(right, pinnedId ? frames.get(currentId) : null);
    source.querySelector('[value="B"]').disabled = !pinnedId;
    if (!pinnedId && source.value === 'B') source.value = 'A';
    unpin.disabled = !pinnedId;
    nextDifference.disabled = !pinnedId;
    previousDifference.disabled = !pinnedId;
    summarizeDifference.disabled = !pinnedId;
    pin.disabled = pinnedId === currentId;
    announce.textContent = 'Work ' + (ids.indexOf(currentId) + 1) + '/' + ids.length +
      ': ' + lookup.get(currentId).name +
      (pinnedId ? ' · A pinned: ' + lookup.get(pinnedId).name + ' · B: current selection' : ' · single artwork study');
  }
  function clearImages() {
    resetPixel();
    present(left, null);
    present(right, null);
  }
  function close() {
    if (dialog.open) dialog.close();
    clearImages(); // Revoked object URLs must not survive in the inspector.
  }
  function move(offset) {
    currentId = studyNextId(ids, currentId, offset);
    paint();
    if (pixelOpen) void updatePixel();
  }
  function pinCurrent() {
    if (pinnedId === currentId) return;
    pinnedId = currentId;
    paint();
    // Keyboard P must invalidate the old A reading just like the visible button.
    if (pixelOpen) void updatePixel(true);
  }
  const updateLaunch = () => { launch.disabled = !snapshot(); };
  const observer = new MutationObserver(updateLaunch);
  observer.observe(indexStatus, { childList: true, characterData: true, subtree: true });
  for (const image of images.values()) image?.addEventListener('load', updateLaunch);
  launch.addEventListener('click', () => {
    if (!snapshot()) { updateLaunch(); return; }
    currentId = lookup.has(select.value) ? select.value : ids[0];
    pinnedId = null;
    dialog.showModal();
    paint();
    forward.focus();
  });
  back.addEventListener('click', () => move(-1));
  forward.addEventListener('click', () => move(1));
  pin.addEventListener('click', pinCurrent);
  unpin.addEventListener('click', () => { pinnedId = null; paint(); if (pixelOpen) void updatePixel(true); });
  closeButton.addEventListener('click', close);
  function saveSelectedBytes(bytes, mime, filename) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const link = make('a', { href: url, download: filename });
    document.body.append(link);
    try { link.click(); } finally {
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }
  savePixel.addEventListener('click', () => {
    try {
      if (!pixelOpen || !dialog.open) throw new Error('Open exact pixel inspection first.');
      const records = snapshot();
      if (!records) throw new Error('Rebuild the verified accepted CPU index.');
      const inspectedId = pixelId(), column = Number(x.value), row = Number(y.value);
      const currentSource = (id) => {
        const entry = lookup.get(id), record = records.get(id);
        if (!entry || !record) throw new Error('Accepted source is unavailable.');
        // A fresh lease and decoded PNG check for EACH source at download time:
        // cached pixels and DOM readout alone do not authorize a saved receipt.
        const png = getAcceptedVisualIndexPng(panel, id, record.url, record.hash);
        const pixels = verifyStudyPng(png,
          entry.exportCrop.widthPx, entry.exportCrop.heightPx, record.hash);
        return { entry, pixels, hash: record.hash };
      };
      const a = currentSource(pinnedId ?? inspectedId);
      const b = pinnedId ? currentSource(currentId) : null;
      const receipt = buildStudyPixelReceipt(a, b, column, row, inspectedId);
      const comparisonName = b ? a.entry.id + '-vs-' + b.entry.id : a.entry.id;
      const filename = 'fieldweaver-pixel-' + comparisonName +
        '-x' + column + '-y' + row + '.fwpixel.json';
      saveSelectedBytes(new TextEncoder().encode(JSON.stringify(receipt, null, 2) + '\n'),
        'application/json', filename);
      announce.textContent = 'Requested exact CPU pixel receipt for ' + a.entry.name +
        (b ? ' vs ' + b.entry.name : '') + '; file delivery is browser-controlled.';
    } catch (error) {
      announce.textContent = 'Pixel receipt refused: ' + (error?.message ?? String(error));
    }
  });
  exportPng.addEventListener('click', () => {
    try {
      const entry = lookup.get(currentId), record = snapshot()?.get(currentId);
      if (!entry || !record) throw new Error('Rebuild the verified accepted CPU index.');
      const png = getAcceptedVisualIndexPng(panel, currentId, record.url, record.hash);
      verifyStudyPng(png, entry.exportCrop.widthPx, entry.exportCrop.heightPx, record.hash);
      saveSelectedBytes(png, 'image/png',
        'fieldweaver-' + currentId + '-' + record.hash + '.png');
      announce.textContent = 'Requested verified CPU PNG for ' + entry.name +
        '; file delivery is browser-controlled.';
    } catch (error) {
      announce.textContent = 'PNG export refused: ' + (error?.message ?? String(error));
    }
  });
  exportRecipe.addEventListener('click', () => {
    try {
      const entry = lookup.get(currentId), record = snapshot()?.get(currentId);
      if (!entry || !record) throw new Error('Rebuild the verified accepted CPU index.');
      // Recipe identity alone does not establish that the displayed CPU proof
      // still belongs to this live gallery generation. Match the same lease
      // and re-decoded RGBA8 oracle required by PNG/provenance exports.
      const png = getAcceptedVisualIndexPng(panel, currentId, record.url, record.hash);
      verifyStudyPng(png, entry.exportCrop.widthPx, entry.exportCrop.heightPx, record.hash);
      // B is the currently browsed work when A is pinned. No editor adoption.
      const handoff = buildAcceptedRecipeHandoff(currentId);
      if (handoff.recipeHash !== entry.recipeHash) throw new Error('Accepted recipe identity mismatch.');
      saveSelectedBytes(new TextEncoder().encode(handoff.json), 'application/json', handoff.filename);
      announce.textContent = 'Requested importable recipe for ' + entry.name +
        ' · reproduce at tick ' + handoff.targetTick + ' with its accepted crop.';
    } catch (error) {
      announce.textContent = 'Recipe export refused: ' + (error?.message ?? String(error));
    }
  });
  exportProvenance.addEventListener('click', () => {
    try {
      const entry = lookup.get(currentId), record = snapshot()?.get(currentId);
      if (!entry || !record) throw new Error('Rebuild the verified accepted CPU index.');
      // The currently browsed B owns the export, not pinned A. Source bytes
      // and the complete FW-012 receipt are tied to the same live blob lease.
      const png = getAcceptedVisualIndexPng(panel, currentId, record.url, record.hash);
      const provenanceJson = getAcceptedVisualIndexProvenance(panel, currentId, record.url, record.hash);
      verifyOfflineExhibitionTile(entry, {
        id: entry.id, name: entry.name, seed: entry.seed, recipeHash: entry.recipeHash,
        targetTick: entry.targetTick, rawRgbaHash: record.hash,
        widthPx: entry.exportCrop.widthPx, heightPx: entry.exportCrop.heightPx,
        png, provenanceJson
      });
      saveSelectedBytes(new TextEncoder().encode(provenanceJson), 'application/json',
        'fieldweaver-' + currentId + '-' + record.hash + '.fwprovenance.json');
      announce.textContent = 'Requested full canonical provenance for ' + entry.name +
        '; file delivery is browser-controlled.';
    } catch (error) {
      announce.textContent = 'Provenance export refused: ' + (error?.message ?? String(error));
    }
  });
  exportBoard.addEventListener('click', () => {
    if (!snapshot() || saveBoard.disabled) {
      announce.textContent = 'Offline export unavailable; regenerate four verified accepted CPU proofs.';
      return;
    }
    // Reuse the accepted source-verified offline board; retain inspected pixels
    // and the A/B composition. No new gallery, renderer or recipe adoption.
    saveBoard.click();
    announce.textContent = boardStatus.textContent || 'Accepted board export requested.';
  });
  dialog.addEventListener('close', clearImages);
  dialog.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
    if (event.key.toLowerCase() === 'p' && event.target.tagName !== 'INPUT') {
      event.preventDefault(); pinCurrent();
    }
  });
  load.addEventListener('click', () => {
    if (!snapshot()) { close(); return; }
    close();
    cards.get(currentId).click();
    panel.querySelector('#preset-load').click(); // Existing transactional recipe adoption.
    launch.focus();
  });
  indexRender.addEventListener('click', () => { close(); launch.disabled = true; }, { capture: true });
  indexCancel.addEventListener('click', close, { capture: true });
  window.addEventListener('pagehide', () => { close(); observer.disconnect(); }, { once: true });
  updateLaunch();
  panel.dataset.exhibitionStudyReady = 'true';
}

function mountWhenReady(attempt = 0) {
  const panel = document.querySelector('.preset-panel[data-visual-index-ready="true"]');
  if (panel) return mountExhibitionStudy(panel);
  if (attempt < 180) requestAnimationFrame(() => mountWhenReady(attempt + 1));
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => mountWhenReady(), { once: true });
  } else mountWhenReady();
}
