import { exhibitionEntries } from './exhibition-catalog.js';
import { renderVisualIndexProof } from './exhibition-visual-index-model.js';
import { buildOfflineExhibitionBoard } from './exhibition-offline-board.js';

// Internal read-only access to the exact FW-012 proof bytes already verified
// by the visual index. This never exposes a WebGL screenshot or stale blob.
const proofRegistries = new WeakMap();
export function getAcceptedVisualIndexPng(panel, id, url, rawRgbaHash) {
  const registry = proofRegistries.get(panel);
  const proof = registry?.proofs.get(id);
  if (!url?.startsWith('blob:') || registry?.urls.get(id) !== url ||
      proof?.id !== id || proof?.rawRgbaHash !== rawRgbaHash ||
      !/^[0-9a-f]{16}$/.test(rawRgbaHash)) {
    throw new Error('Current verified CPU proof is unavailable or mismatched.');
  }
  return proof.png.slice(); // detached copy, not mutable ownership
}

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
  const verifiedProofs = new Map();
  proofRegistries.set(panel, { proofs: verifiedProofs, urls });
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
  const saveBoard = document.createElement('button');
  saveBoard.id = 'exhibition-board-save';
  saveBoard.type = 'button';
  saveBoard.className = 'button';
  saveBoard.textContent = 'Save offline board (HTML)';
  saveBoard.disabled = true;
  const status = document.createElement('output');
  status.id = 'exhibition-index-status';
  status.className = 'workspace-note';
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Opt in to generate actual CPU thumbnails; no WebGL or imported art.';
  const boardStatus = document.createElement('output');
  boardStatus.id = 'exhibition-board-status';
  boardStatus.className = 'workspace-note';
  boardStatus.setAttribute('aria-live', 'polite');
  controls.append(render, cancel, saveBoard, status, boardStatus);
  grid.after(controls);

  const revoke = (id) => {
    if (urls.has(id)) URL.revokeObjectURL(urls.get(id));
    urls.delete(id);
  };

  render.addEventListener('click', async () => {
    const run = ++generation;
    render.disabled = true;
    cancel.disabled = false;
    saveBoard.disabled = true;
    verifiedProofs.clear();
    boardStatus.textContent = '';
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
          verifiedProofs.set(entry.id, proof);
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
        saveBoard.disabled = completed !== entries.length;
      }
    } catch (error) {
      if (!leaving && generation === run) {
        verifiedProofs.clear();
        saveBoard.disabled = true;
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
    verifiedProofs.clear();
    saveBoard.disabled = true;
    boardStatus.textContent = '';
    render.disabled = false;
    cancel.disabled = true;
    status.textContent = 'Cancelled between entries; completed proofs remain.';
  });
  saveBoard.addEventListener('click', () => {
    if (leaving || saveBoard.disabled || verifiedProofs.size !== entries.length) return;
    try {
      const board = buildOfflineExhibitionBoard(entries.map((entry) => verifiedProofs.get(entry.id)));
      const url = URL.createObjectURL(new Blob([board.html], { type: 'text/html;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'fieldweaver-accepted-canonical-board.html';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      boardStatus.textContent = 'Offline canonical board download requested: ' + board.count + ' accepted proofs.';
    } catch (error) {
      boardStatus.textContent = 'Offline board unavailable: ' + (error?.message ?? String(error));
    }
  });
  window.addEventListener('pagehide', () => {
    leaving = true;
    verifiedProofs.clear();
    proofRegistries.delete(panel);
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
