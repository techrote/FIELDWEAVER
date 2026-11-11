import { exhibitionEntries } from './exhibition-catalog.js';

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
  const select = panel.querySelector('#preset-select');
  if (!grid || !controls || !indexStatus || !indexRender || !indexCancel || !select) {
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
  toolbar.append(back, forward, pin, unpin, load);
  const description = make('p', { class: 'workspace-note', id: 'exhibition-study-help' },
    'Left/Right: browse · P: pin A · Escape: close. Only locally verified canonical CPU images; no WebGL pixels.');
  const gallery = make('div', { class: 'exhibition-study-frames', role: 'group',
    'aria-label': 'Accepted canonical artwork images' });
  function frame(letter) {
    const box = make('figure', { class: 'exhibition-study-frame' });
    const heading = make('h3');
    const img = make('img', { alt: '' });
    const caption = make('figcaption', { class: 'workspace-note' });
    box.append(heading, img, caption);
    gallery.append(box);
    return { box, heading, img, caption, letter };
  }
  const left = frame('A'), right = frame('B');
  const announce = make('output', { id: 'exhibition-study-status', 'aria-live': 'polite',
    class: 'workspace-note' }, 'No study open.');
  dialog.append(header, toolbar, description, gallery, announce);
  document.body.append(dialog);

  let currentId = ids[0];
  let pinnedId = null;
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
      result.set(entry.id, { label, url: image.currentSrc });
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
  function paint() {
    const frames = snapshot();
    if (!frames) { close(); return; }
    present(left, frames.get(pinnedId ?? currentId));
    present(right, pinnedId ? frames.get(currentId) : null);
    unpin.disabled = !pinnedId;
    pin.disabled = pinnedId === currentId;
    announce.textContent = 'Work ' + (ids.indexOf(currentId) + 1) + '/' + ids.length +
      ': ' + lookup.get(currentId).name +
      (pinnedId ? ' · A pinned: ' + lookup.get(pinnedId).name + ' · B: current selection' : ' · single artwork study');
  }
  function clearImages() {
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
  pin.addEventListener('click', () => { pinnedId = currentId; paint(); });
  unpin.addEventListener('click', () => { pinnedId = null; paint(); });
  closeButton.addEventListener('click', close);
  dialog.addEventListener('close', clearImages);
  dialog.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
    if (event.key.toLowerCase() === 'p' && event.target.tagName !== 'INPUT') {
      event.preventDefault(); pinnedId = currentId; paint();
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
