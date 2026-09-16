import { getActiveRecipeEditorSession } from '../editor/index.js';
import { createCanonicalExport } from '../export/index.js';

function element(tag, attributes = {}, text = '') {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') node.className = value;
    else node.setAttribute(key, value);
  }
  if (text) node.textContent = text;
  return node;
}

function labeled(text, control) {
  const label = element('label', { className: 'control-label' });
  label.append(element('span', {}, text), control);
  return label;
}

function button(id, text) {
  return element('button', { id, type: 'button', className: 'button' }, text);
}

function numberInput(id, value, min, max) {
  return element('input', { id, type: 'number', step: '1', value: String(value), min: String(min), max: String(max) });
}

function downloadBytes(bytes, type, filename) {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const link = element('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadText(text, type, filename) {
  downloadBytes(new TextEncoder().encode(text), type, filename);
}

export function mountExportPanel(parent) {
  if (!(parent instanceof HTMLElement)) throw new TypeError('Export panel parent must be an HTMLElement.');
  const panel = element('section', { className: 'panel export-panel', 'aria-labelledby': 'export-title' });
  panel.append(element('h2', { id: 'export-title' }, 'Canonical export'));
  panel.append(element('p', { className: 'workspace-note' }, 'Integer software rasterization from recipe replay. This is the canonical image path; the WebGL preview is not used as a pixel source.'));

  const width = numberInput('export-width', 1920, 1, 8192);
  const height = numberInput('export-height', 1080, 1, 8192);
  const targetTick = numberInput('export-tick', 0, 0, 0xffffffff);
  const unitsPerPixel = numberInput('export-units-per-pixel-q16', 16384, 1, 0x7fffffff);
  const chunkX = numberInput('export-center-chunk-x', 0, -0x80000000, 0x7fffffff);
  const chunkY = numberInput('export-center-chunk-y', 0, -0x80000000, 0x7fffffff);
  const localX = numberInput('export-center-local-x', 0, -0x80000000, 0x7fffffff);
  const localY = numberInput('export-center-local-y', 0, -0x80000000, 0x7fffffff);
  const tileSize = numberInput('export-tile-size', 256, 1, 8192);

  const sizeGrid = element('div', { className: 'parameter-grid' });
  sizeGrid.append(labeled('Width px', width), labeled('Height px', height));
  const timingGrid = element('div', { className: 'parameter-grid' });
  timingGrid.append(labeled('Target tick', targetTick), labeled('Units/pixel Q16', unitsPerPixel));
  const chunkGrid = element('div', { className: 'parameter-grid' });
  chunkGrid.append(labeled('Center chunk X', chunkX), labeled('Center chunk Y', chunkY));
  const localGrid = element('div', { className: 'parameter-grid' });
  localGrid.append(labeled('Center local X', localX), labeled('Center local Y', localY));
  panel.append(sizeGrid, timingGrid, chunkGrid, localGrid, labeled('Raster tile size', tileSize));

  const useFraming = button('export-use-recipe-framing', 'Use recipe framing');
  const prepare = button('export-prepare', 'Prepare canonical export');
  const pngDownload = button('export-download-png', 'Download PNG');
  const provenanceDownload = button('export-download-provenance', 'Download provenance');
  pngDownload.disabled = true;
  provenanceDownload.disabled = true;
  const actionGrid = element('div', { className: 'button-grid' });
  actionGrid.append(useFraming, prepare, pngDownload, provenanceDownload);
  panel.append(actionGrid);

  const diagnostics = element('ul', { id: 'export-diagnostics', className: 'diagnostic-list', 'aria-live': 'polite' });
  const hash = element('code', { id: 'export-rgba-hash', className: 'hash-readout' }, '—');
  const status = element('output', { id: 'export-status', className: 'hash-readout', 'aria-live': 'polite' }, 'Ready');
  panel.append(element('p', { className: 'control-label' }, 'Canonical raw RGBA hash'), hash, diagnostics, status);

  const statusPanel = parent.querySelector('.compact-status');
  if (statusPanel) parent.insertBefore(panel, statusPanel);
  else parent.append(panel);

  let lastExport = null;

  const getEditor = () => {
    const editor = getActiveRecipeEditorSession();
    if (!editor || typeof editor.currentRecipe !== 'function') throw new Error('Recipe-aware editor is not initialized yet.');
    return editor;
  };

  const applyRecipeFraming = () => {
    const editor = getEditor();
    const recipe = editor.currentRecipe();
    const framing = recipe.framing;
    width.value = String(Math.min(8192, framing.widthPx));
    height.value = String(Math.min(8192, framing.heightPx));
    unitsPerPixel.value = String(framing.unitsPerPixelQ16);
    chunkX.value = String(framing.center.chunkX);
    chunkY.value = String(framing.center.chunkY);
    localX.value = String(framing.center.localX);
    localY.value = String(framing.center.localY);
    targetTick.value = String(editor.simulation?.tick ?? 0);
  };

  const cropFromControls = () => ({
    widthPx: Number(width.value),
    heightPx: Number(height.value),
    unitsPerPixelQ16: Number(unitsPerPixel.value),
    center: {
      chunkX: Number(chunkX.value),
      chunkY: Number(chunkY.value),
      localX: Number(localX.value),
      localY: Number(localY.value)
    }
  });

  const publish = (state, text) => {
    status.value = text;
    status.textContent = text;
    document.documentElement.dataset.fieldweaverExportState = state;
    if (lastExport) {
      document.documentElement.dataset.fieldweaverCanonicalExportHash = lastExport.rawRgbaHash;
      document.documentElement.dataset.fieldweaverCanonicalExportTick = String(lastExport.targetTick);
      document.documentElement.dataset.fieldweaverCanonicalExportPngBytes = String(lastExport.png.length);
      document.documentElement.dataset.fieldweaverCanonicalExportDepositions = String(lastExport.depositionCount);
    }
  };

  useFraming.addEventListener('click', () => {
    try {
      applyRecipeFraming();
      publish('ready', 'Recipe framing loaded.');
    } catch (error) {
      publish('error', `Framing failed: ${error?.message ?? String(error)}`);
    }
  });

  prepare.addEventListener('click', () => {
    try {
      publish('working', 'Replaying recipe and rasterizing canonical pixels…');
      const editor = getEditor();
      const tile = Number(tileSize.value);
      lastExport = createCanonicalExport(editor.currentRecipe(), {
        targetTick: Number(targetTick.value),
        crop: cropFromControls(),
        agentCapacity: editor.agentCapacity,
        maxDepositions: editor.maxDepositions,
        tileWidthPx: tile,
        tileHeightPx: tile
      });
      hash.textContent = lastExport.rawRgbaHash;
      diagnostics.replaceChildren(
        element('li', {}, `Canonical software raster · ${lastExport.crop.widthPx}×${lastExport.crop.heightPx} RGBA8`),
        element('li', {}, `Tick ${lastExport.targetTick} · ${lastExport.depositionCount} deposition records`),
        element('li', {}, `PNG package: ${lastExport.png.length} bytes · raw pixels: ${lastExport.rgba.length} bytes`),
        element('li', {}, `Recipe ${lastExport.recipeHash} · state ${lastExport.stateHash}`)
      );
      pngDownload.disabled = false;
      provenanceDownload.disabled = false;
      publish('ready', `Canonical export ready: ${lastExport.rawRgbaHash}`);
    } catch (error) {
      lastExport = null;
      hash.textContent = '—';
      diagnostics.replaceChildren();
      pngDownload.disabled = true;
      provenanceDownload.disabled = true;
      publish('error', `Export failed: ${error?.message ?? String(error)}`);
    }
  });

  pngDownload.addEventListener('click', () => {
    if (!lastExport) return;
    downloadBytes(lastExport.png, 'image/png', `fieldweaver-${lastExport.rawRgbaHash}.png`);
  });
  provenanceDownload.addEventListener('click', () => {
    if (!lastExport) return;
    downloadText(lastExport.provenanceJson, 'application/json', `fieldweaver-${lastExport.rawRgbaHash}.fwexport.json`);
  });

  try { applyRecipeFraming(); } catch { /* editor initialization can complete after panel mount */ }
  publish('ready', 'Ready');
  panel.dataset.ready = 'true';
  return Object.freeze({ panel, controls: Object.freeze({ width, height, targetTick, unitsPerPixel, chunkX, chunkY, localX, localY, tileSize, useFraming, prepare, pngDownload, provenanceDownload, diagnostics, hash, status }) });
}

function mountWhenReady(attempt = 0) {
  const parent = document.querySelector('.editor-sidebar');
  if (parent) {
    mountExportPanel(parent);
    return;
  }
  if (attempt < 120) requestAnimationFrame(() => mountWhenReady(attempt + 1));
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', () => mountWhenReady(), { once: true });
else mountWhenReady();
