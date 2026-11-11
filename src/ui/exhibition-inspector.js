import { compareExhibitionProofs } from './exhibition-catalog.js';
import { getBuiltinPreset } from '../presets/index.js';

// Presentation metadata only. Each input is a completed FW-012 CPU proof.
// This never rerenders, blends, rescales or changes the pixel identity.
export function inspectionSlots(pinnedProof, currentProof) {
  const describe = (proof) => {
    if (!proof) return null;
    compareExhibitionProofs(proof, proof);
    const preset = getBuiltinPreset(proof.presetId);
    const crop = proof.crop;
    return Object.freeze({
      id: preset.id,
      title: preset.name,
      alt: 'Canonical CPU software-raster artwork: ' + preset.name +
        ', tick ' + proof.targetTick,
      details: 'Seed ' + (preset.recipe.seed >>> 0) +
        ' · tick ' + proof.targetTick +
        ' · crop ' + crop.widthPx + '×' + crop.heightPx +
        ' · Q16 units/px ' + crop.unitsPerPixelQ16 +
        ' · chunk ' + crop.center.chunkX + ',' + crop.center.chunkY +
        ' · recipe ' + proof.recipeHash +
        ' · raw RGBA8 ' + proof.rawRgbaHash,
      widthPx: crop.widthPx,
      rawRgbaHash: proof.rawRgbaHash
    });
  };
  return Object.freeze({
    a: describe(pinnedProof ?? currentProof),
    b: pinnedProof ? describe(currentProof) : null
  });
}

function element(tag, attributes = {}, text = '') {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text) node.textContent = text;
  return node;
}

// Modal inspector only reuses object URLs for verified software-raster PNGs.
// URL ownership and revocation remain with the exhibition panel.
export function mountExhibitionInspector() {
  const dialog = element('dialog', {
    id: 'exhibition-inspector',
    class: 'exhibition-inspector',
    'aria-labelledby': 'exhibition-inspector-title'
  });
  const header = element('div', { class: 'exhibition-inspector-header' });
  header.append(
    element('h2', { id: 'exhibition-inspector-title' }, 'Canonical artwork inspection'),
    element('button', { id: 'exhibition-inspector-close', type: 'button', class: 'button' }, 'Close inspection')
  );
  const toolbar = element('div', { class: 'exhibition-inspector-toolbar' });
  const zoomLabel = element('label', { for: 'exhibition-inspector-zoom' }, 'View scale');
  const zoom = element('select', { id: 'exhibition-inspector-zoom' });
  for (const [value, title] of [['fit','Fit to frame'],['2','2× actual pixels'],['4','4× actual pixels'],['8','8× actual pixels']]) {
    zoom.append(element('option', { value }, title));
  }
  toolbar.append(
    zoomLabel, zoom,
    element('span', { class: 'workspace-note' }, 'Nearest-neighbour display only · canonical decoded RGBA8 remains unchanged')
  );
  const gallery = element('div', { class: 'exhibition-inspector-gallery', role: 'group', 'aria-label': 'Full-size canonical proof inspection' });
  function makeFrame(letter) {
    const frame = element('figure', { class: 'exhibition-inspector-frame' });
    const title = element('h3', {}, letter);
    const image = element('img', { alt: '' });
    const caption = element('figcaption', { class: 'workspace-note' });
    frame.append(title, image, caption);
    gallery.append(frame);
    return { frame, title, image, caption };
  }
  const a = makeFrame('A'), b = makeFrame('B');
  dialog.append(header, toolbar, gallery);
  document.body.append(dialog);
  let presented = null;
  const frames = [a, b];
  const reset = () => {
    for (const frame of frames) {
      frame.image.removeAttribute('src');
      frame.image.alt = '';
      frame.image.style.removeProperty('width');
      frame.frame.hidden = true;
    }
    presented = null;
  };
  const scale = () => {
    if (!presented) return;
    frames.forEach((frame, index) => {
      const slot = index === 0 ? presented.a : presented.b;
      if (!slot) return;
      frame.image.style.width = zoom.value === 'fit' ?
        'min(100%, 36rem)' : (slot.widthPx * Number(zoom.value)) + 'px';
    });
  };
  zoom.addEventListener('change', scale);
  dialog.querySelector('#exhibition-inspector-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', reset);
  const close = () => {
    if (dialog.open) dialog.close();
    reset();
  };
  const open = ({ pinnedProof = null, pinnedUrl = null, currentProof = null, currentUrl = null }) => {
    close();
    const slots = inspectionSlots(pinnedProof, currentProof);
    if (!slots.a) throw new Error('Render a canonical work before opening inspection.');
    const sources = [pinnedProof ? pinnedUrl : currentUrl, pinnedProof ? currentUrl : null];
    if (!sources[0] || (slots.b && !sources[1])) {
      throw new Error('Canonical inspection source is unavailable.');
    }
    presented = slots;
    frames.forEach((frame, index) => {
      const slot = index === 0 ? slots.a : slots.b;
      if (!slot) { frame.frame.hidden = true; return; }
      frame.frame.hidden = false;
      frame.title.textContent = (index === 0 ? 'A · ' : 'B · ') + slot.title;
      frame.image.alt = slot.alt;
      frame.image.src = sources[index];
      frame.caption.textContent = slot.details;
    });
    zoom.value = 'fit';
    scale();
    dialog.showModal();
  };
  return Object.freeze({ dialog, open, close });
}
