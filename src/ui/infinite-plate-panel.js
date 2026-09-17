import { Q16_ONE } from '../core/numeric.js';
import { getActiveRecipeEditorSession } from '../editor/index.js';
import { createInfinitePlateExport, InfinitePlateEvaluator, PlateEvaluationAbortedError } from '../infinite/index.js';

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

function setInputValue(selector, value) {
  const node = document.querySelector(selector);
  if (!node) return;
  node.value = String(value);
  node.dispatchEvent(new Event('change', { bubbles: true }));
}

export function mountInfinitePlatePanel(parent) {
  if (!(parent instanceof HTMLElement)) throw new TypeError('Infinite Plate panel parent must be an HTMLElement.');
  const panel = element('section', { className: 'panel infinite-plate-panel', 'aria-labelledby': 'infinite-plate-title' });
  panel.append(element('h2', { id: 'infinite-plate-title' }, 'Infinite Plate'));
  panel.append(element('p', { className: 'workspace-note' }, 'Frame a stable world crop, evaluate it with deterministic regional chunk memoization, and export through the FW-012 software raster. Camera and cache history are noncanonical.'));

  const width = numberInput('plate-width', 960, 1, 8192);
  const height = numberInput('plate-height', 640, 1, 8192);
  const targetTick = numberInput('plate-tick', 0, 0, 0xffffffff);
  const unitsPerPixel = numberInput('plate-units-per-pixel-q16', 16384, 1, 0x7fffffff);
  const chunkX = numberInput('plate-center-chunk-x', 0, -0x80000000, 0x7fffffff);
  const chunkY = numberInput('plate-center-chunk-y', 0, -0x80000000, 0x7fffffff);
  const localX = numberInput('plate-center-local-x', 0, -0x80000000, 0x7fffffff);
  const localY = numberInput('plate-center-local-y', 0, -0x80000000, 0x7fffffff);
  const cacheChunks = numberInput('plate-cache-chunks', 32, 1, 4096);

  const sizeGrid = element('div', { className: 'parameter-grid' });
  sizeGrid.append(labeled('Width px', width), labeled('Height px', height));
  const timingGrid = element('div', { className: 'parameter-grid' });
  timingGrid.append(labeled('Target tick', targetTick), labeled('Units/pixel Q16', unitsPerPixel));
  const chunkGrid = element('div', { className: 'parameter-grid' });
  chunkGrid.append(labeled('Center chunk X', chunkX), labeled('Center chunk Y', chunkY));
  const localGrid = element('div', { className: 'parameter-grid' });
  localGrid.append(labeled('Center local X', localX), labeled('Center local Y', localY));
  panel.append(sizeGrid, timingGrid, chunkGrid, localGrid, labeled('Chunk cache entries', cacheChunks));

  const frameView = button('plate-frame-view', 'Frame current view');
  const evaluate = button('plate-evaluate', 'Evaluate selected crop');
  const cancel = button('plate-cancel', 'Cancel evaluation');
  const clearCache = button('plate-clear-cache', 'Evict cache');
  const livePreview = button('plate-live-preview', 'Return to live preview');
  const pngDownload = button('plate-download-png', 'Download canonical PNG');
  const provenanceDownload = button('plate-download-provenance', 'Download provenance');
  cancel.disabled = true;
  pngDownload.disabled = true;
  provenanceDownload.disabled = true;
  const actionGrid = element('div', { className: 'button-grid' });
  actionGrid.append(frameView, evaluate, cancel, clearCache, livePreview, pngDownload, provenanceDownload);
  panel.append(actionGrid);

  const hash = element('code', { id: 'plate-rgba-hash', className: 'hash-readout' }, '—');
  const diagnostics = element('ul', { id: 'plate-diagnostics', className: 'diagnostic-list', 'aria-live': 'polite' });
  const status = element('output', { id: 'plate-status', className: 'hash-readout', 'aria-live': 'polite' }, 'Ready');
  panel.append(element('p', { className: 'control-label' }, 'Canonical crop RGBA hash'), hash, diagnostics, status);

  const exportPanel = parent.querySelector('.export-panel');
  const statusPanel = parent.querySelector('.compact-status');
  if (exportPanel?.nextSibling) parent.insertBefore(panel, exportPanel.nextSibling);
  else if (statusPanel) parent.insertBefore(panel, statusPanel);
  else parent.append(panel);

  const evaluator = new InfinitePlateEvaluator({ cacheChunks: Number(cacheChunks.value) });
  let activeController = null;
  let lastEvaluation = null;
  let lastExport = null;
  let lastRecipe = null;

  const getEditor = () => {
    const editor = getActiveRecipeEditorSession();
    if (!editor || typeof editor.currentRecipe !== 'function') throw new Error('Recipe-aware editor is not initialized yet.');
    return editor;
  };

  const cropFromControls = () => ({
    widthPx: Number(width.value),
    heightPx: Number(height.value),
    unitsPerPixelQ16: Number(unitsPerPixel.value),
    center: {
      chunkX: Number(chunkX.value), chunkY: Number(chunkY.value),
      localX: Number(localX.value), localY: Number(localY.value)
    }
  });

  const publish = (state, text) => {
    status.value = text;
    status.textContent = text;
    document.documentElement.dataset.fieldweaverInfiniteState = state;
    document.documentElement.dataset.fieldweaverInfiniteCacheSize = String(evaluator.cache.size);
    if (lastEvaluation) {
      document.documentElement.dataset.fieldweaverInfiniteRawHash = lastEvaluation.rawRgbaHash;
      document.documentElement.dataset.fieldweaverInfiniteDomainHash = lastEvaluation.domainHash;
      document.documentElement.dataset.fieldweaverInfiniteStateHash = lastEvaluation.sourceStateHash;
      document.documentElement.dataset.fieldweaverInfiniteDepositionHash = lastEvaluation.depositionHash;
      document.documentElement.dataset.fieldweaverInfiniteChunks = String(lastEvaluation.chunkCount);
      document.documentElement.dataset.fieldweaverInfiniteCacheHit = String(lastEvaluation.cacheHit);
    }
  };

  const syncFw012Crop = () => {
    const crop = cropFromControls();
    setInputValue('#export-width', crop.widthPx);
    setInputValue('#export-height', crop.heightPx);
    setInputValue('#export-tick', Number(targetTick.value));
    setInputValue('#export-units-per-pixel-q16', crop.unitsPerPixelQ16);
    setInputValue('#export-center-chunk-x', crop.center.chunkX);
    setInputValue('#export-center-chunk-y', crop.center.chunkY);
    setInputValue('#export-center-local-x', crop.center.localX);
    setInputValue('#export-center-local-y', crop.center.localY);
  };

  const frameCurrentView = () => {
    const data = document.documentElement.dataset;
    if (data.fieldweaverViewChunkX === undefined) throw new Error('Renderer view coordinates are not available yet.');
    width.value = String(Math.max(1, Math.round(Number(data.fieldweaverViewWidthCssPx ?? 960))));
    height.value = String(Math.max(1, Math.round(Number(data.fieldweaverViewHeightCssPx ?? 640))));
    const zoom = Number(data.fieldweaverViewZoom ?? 1);
    unitsPerPixel.value = String(Math.max(1, Math.round(Q16_ONE / Math.max(0.000001, zoom))));
    chunkX.value = data.fieldweaverViewChunkX;
    chunkY.value = data.fieldweaverViewChunkY;
    localX.value = data.fieldweaverViewLocalX;
    localY.value = data.fieldweaverViewLocalY;
    const editor = getEditor();
    targetTick.value = String(editor.simulation?.tick ?? 0);
    syncFw012Crop();
  };

  frameView.addEventListener('click', () => {
    try {
      frameCurrentView();
      publish('ready', 'Current camera framed as a stable world crop; recipe state was not changed.');
    } catch (error) {
      publish('error', `Frame failed: ${error?.message ?? String(error)}`);
    }
  });

  clearCache.addEventListener('click', () => {
    evaluator.clearCache();
    publish('ready', 'Chunk cache evicted. Canonical results are unchanged.');
  });

  livePreview.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('fieldweaver:infinite-preview-clear'));
    publish('ready', 'Live editor preview restored.');
  });

  cancel.addEventListener('click', () => activeController?.abort());

  evaluate.addEventListener('click', async () => {
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    evaluate.disabled = true;
    cancel.disabled = false;
    pngDownload.disabled = true;
    provenanceDownload.disabled = true;
    lastEvaluation = null;
    lastExport = null;
    hash.textContent = '—';
    diagnostics.replaceChildren();
    try {
      evaluator.setCacheCapacity(Number(cacheChunks.value));
      const editor = getEditor();
      const recipe = editor.currentRecipe();
      const expectedRecipeHash = editor.recipeHash();
      const crop = cropFromControls();
      syncFw012Crop();
      publish('working', 'Evaluating requested chunks from deterministic recipe replay…');
      const evaluation = await evaluator.evaluateAsync(recipe, {
        targetTick: Number(targetTick.value),
        crop,
        agentCapacity: editor.agentCapacity,
        maxDepositions: editor.maxDepositions,
        signal: controller.signal,
        tickBatch: 32,
        yieldControl: () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
        onProgress: ({ tick, targetTick: finalTick }) => publish('working', `Evaluating canonical replay ${tick}/${finalTick}…`)
      });
      if (editor.recipeHash() !== expectedRecipeHash) throw new Error('Authoring changed during evaluation; stale regional result was discarded.');
      lastEvaluation = evaluation;
      lastRecipe = recipe;
      lastExport = createInfinitePlateExport(recipe, { evaluation, evaluator });
      hash.textContent = evaluation.rawRgbaHash;
      diagnostics.replaceChildren(
        element('li', {}, `${evaluation.chunkCount} requested chunk(s) · ${evaluation.cacheHit ? 'cache hit' : 'reference replay'}`),
        element('li', {}, `Tick ${evaluation.targetTick} · causal halo ${evaluation.causality.causalHaloQ16} Q16`),
        element('li', {}, `${evaluation.depositionCount}/${evaluation.sourceDepositionCount} deposition records intersect requested chunks`),
        element('li', {}, `Domain ${evaluation.domainHash} · state ${evaluation.sourceStateHash}`),
        element('li', {}, `FW-012 software raster/PNG · ${lastExport.png.length} bytes`)
      );
      pngDownload.disabled = false;
      provenanceDownload.disabled = false;
      window.dispatchEvent(new CustomEvent('fieldweaver:infinite-preview', { detail: { depositions: evaluation.depositions, domainHash: evaluation.domainHash } }));
      publish('ready', `Infinite Plate crop ready: ${evaluation.rawRgbaHash}`);
    } catch (error) {
      if (error instanceof PlateEvaluationAbortedError || controller.signal.aborted) publish('cancelled', 'Evaluation cancelled before publishing a canonical result.');
      else publish('error', `Evaluation failed: ${error?.message ?? String(error)}`);
    } finally {
      if (activeController === controller) activeController = null;
      evaluate.disabled = false;
      cancel.disabled = true;
    }
  });

  pngDownload.addEventListener('click', () => {
    if (!lastExport || !lastRecipe) return;
    downloadBytes(lastExport.png, 'image/png', `fieldweaver-plate-${lastExport.rawRgbaHash}.png`);
  });
  provenanceDownload.addEventListener('click', () => {
    if (!lastExport || !lastRecipe) return;
    downloadText(lastExport.provenanceJson, 'application/json', `fieldweaver-plate-${lastExport.rawRgbaHash}.fwexport.json`);
  });

  try { frameCurrentView(); } catch { /* renderer/editor may finish after the panel mounts */ }
  publish('ready', 'Ready');
  panel.dataset.ready = 'true';
  return Object.freeze({
    panel,
    evaluator,
    controls: Object.freeze({ width, height, targetTick, unitsPerPixel, chunkX, chunkY, localX, localY, cacheChunks, frameView, evaluate, cancel, clearCache, livePreview, pngDownload, provenanceDownload, hash, diagnostics, status })
  });
}

function mountWhenReady(attempt = 0) {
  const parent = document.querySelector('.editor-sidebar');
  if (parent) {
    mountInfinitePlatePanel(parent);
    return;
  }
  if (attempt < 120) requestAnimationFrame(() => mountWhenReady(attempt + 1));
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', () => mountWhenReady(), { once: true });
else mountWhenReady();
