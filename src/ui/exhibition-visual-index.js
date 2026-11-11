import { exhibitionEntries } from './exhibition-catalog.js';
import { renderVisualIndexProof } from './exhibition-visual-index-model.js';

// Augment the existing native-button gallery. Never replace the accepted
// catalog, change the editor, or use a WebGL frame as artwork evidence.
export function mountExhibitionVisualIndex(panel) {
  if (!(panel instanceof HTMLElement)) throw new TypeError('An exhibition panel is required.');
  if (panel.dataset.visualIndexReady === 'true') return;
  const grid = panel.querySelector('#exhibition-grid');
  const entries = exhibitionEntries();
  if (!grid || !panel.querySelector('#preset-select')) throw new Error('Accepted exhibition controls are unavailable.');
  const tiles = new Map();
  const urls = new Map();
  let generation = 0;
  let leaving = false;
  for (const entry of entries) {
    const card = [...grid.querySelectorAll('[data-exhibition-id]')].find((item) => item.dataset.exhibitionId === entry.id);
    if (!card) throw new Error('Missing accepted card ' + entry.id);
    const img = document.createElement('img');
    img.className = 'exhibition-index-image';
    img.alt = 'Canonical CPU image for ' + entry.name;
    img.hidden = true;
    const trace = document.createElement('span');
    trace.className = 'exhibition-index-trace';
    trace.textContent = 'No canonical image yet';
    card.prepend(img);
    card.append(trace);
    tiles.set(entry.id, { card, img, trace });
  }
  const controls = document.createElement('div');
  controls.className = 'exhibition-index-controls';
  const render = document.createElement('button');
  render.id = 'exhibition-index-render';
  render.type = 'button';
  render.className = 'button';
  render.textContent = 'Render visual index (4 CPU proofs)';
  const cancel = document.createElement('button');
  cancel.id = 'exhibition-index-cancel';
  cancel.type = 'button';
  cancel.className = 'button';
  cancel.textContent = 'Cancel';
  cancel.disabled = true;
  const status = document.createElement('output');
  status.id = 'exhibition-index-status';
  status.className = 'workspace-note';
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Opt in to generate actual CPU thumbnails; no WebGL or imported art.';
  controls.append(render, cancel, status);
  grid.after(controls);

  const revoke = (id) => {
    if (urls.has(id)) URL.revokeObjectURL(urls.get(id));
    urls.delete(id);
  };

  render.addEventListener('click', async () => {
    const run = ++generation;
    render.disabled = true;
    cancel.disabled = false;
    let completed = 0;
    try {
      for (const entry of entries) {
        status.textContent = 'Canonical replay ' + (completed + 1) + '/' + entries.length + ': ' + entry.name;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (leaving || generation !== run) break;
        const proof = renderVisualIndexProof(entry.id);
        if (leaving || generation !== run) break;
        const { card, img, trace } = tiles.get(entry.id);
        const url = URL.createObjectURL(new Blob([proof.png], { type: 'image/png' }));
        const candidate = new Image();
        candidate.src = url;
        try {
          await candidate.decode();
          if (leaving || generation !== run) {
            URL.revokeObjectURL(url);
            break;
          }
          if (candidate.naturalWidth !== proof.widthPx || candidate.naturalHeight !== proof.heightPx) {
            throw new Error('Browser-decoded dimensions differ from verified PNG.');
          }
          revoke(entry.id);
          urls.set(entry.id, url);
          img.src = url;
          img.hidden = false;
          card.dataset.canonicalRgbaHash = proof.rawRgbaHash;
          trace.textContent = 'CPU RGBA8 ' + proof.rawRgbaHash;
          completed += 1;
        } catch (error) {
          URL.revokeObjectURL(url);
          throw error;
        }
      }
      if (!leaving && generation === run) {
        status.textContent = 'Visual index ready: ' + completed + '/' + entries.length +
          ' decoded canonical CPU proofs. Select an image to browse.';
        render.textContent = 'Rebuild visual index';
      }
    } catch (error) {
      if (!leaving && generation === run) {
        status.textContent = 'Visual index stopped at ' + completed + '/' + entries.length +
          ': ' + (error?.message ?? String(error));
      }
    } finally {
      if (!leaving && generation === run) {
        render.disabled = false;
        cancel.disabled = true;
      }
    }
  });

  cancel.addEventListener('click', () => {
    generation += 1;
    render.disabled = false;
    cancel.disabled = true;
    status.textContent = 'Cancelled between entries; completed proofs remain.';
  });
  window.addEventListener('pagehide', () => {
    leaving = true;
    generation += 1;
    for (const id of [...urls.keys()]) revoke(id);
  }, { once: true });
  panel.dataset.visualIndexReady = 'true';
}

function mountWhenReady(attempt = 0) {
  const panel = document.querySelector('.preset-panel[data-ready="true"]');
  if (panel) return mountExhibitionVisualIndex(panel);
  if (attempt < 180) requestAnimationFrame(() => mountWhenReady(attempt + 1));
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => mountWhenReady(), { once: true });
  } else mountWhenReady();
}
