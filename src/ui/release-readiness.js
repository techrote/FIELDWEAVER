import { getActiveRecipeEditorSession } from '../editor/index.js';
import { getActiveWebGL2Renderer } from '../renderer/index.js';

const TELEMETRY_KEY = Symbol.for('fieldweaver.fw014.telemetry');

function element(tag, attributes = {}, text = '') {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') node.className = value;
    else node.setAttribute(key, value);
  }
  if (text) node.textContent = text;
  return node;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function installSimulationTelemetry(editor) {
  if (editor[TELEMETRY_KEY]) return editor[TELEMETRY_KEY];
  const telemetry = { batches: 0, ticks: 0, lastTicks: 0, lastMs: 0, totalMs: 0 };
  const original = editor.runTicks.bind(editor);
  Object.defineProperty(editor, 'runTicks', {
    configurable: false,
    enumerable: false,
    writable: false,
    value(count) {
      const started = performance.now();
      const result = original(count);
      const elapsed = performance.now() - started;
      telemetry.batches += 1;
      telemetry.ticks += Number(count);
      telemetry.lastTicks = Number(count);
      telemetry.lastMs = elapsed;
      telemetry.totalMs += elapsed;
      return result;
    }
  });
  Object.defineProperty(editor, TELEMETRY_KEY, { value: telemetry, enumerable: false });
  return telemetry;
}

function normalizeFieldListSemantics(fieldList) {
  fieldList.setAttribute('role', 'group');
  fieldList.setAttribute('aria-label', 'Field layers');
  for (const item of fieldList.querySelectorAll('[data-field-id]')) {
    item.removeAttribute('role');
    item.setAttribute('aria-pressed', item.getAttribute('aria-selected') === 'true' ? 'true' : 'false');
    item.removeAttribute('aria-selected');
  }
}

function installAccessibilityFixes() {
  const fieldList = document.querySelector('#field-list');
  if (fieldList) {
    normalizeFieldListSemantics(fieldList);
    new MutationObserver(() => normalizeFieldListSemantics(fieldList)).observe(fieldList, { childList: true });
  }

  const canvas = document.querySelector('#preview-canvas');
  const workspaceNote = document.querySelector('.workspace-heading .workspace-note');
  if (canvas) {
    if (workspaceNote) {
      workspaceNote.id ||= 'workspace-keyboard-help';
      canvas.setAttribute('aria-describedby', workspaceNote.id);
    }
    canvas.setAttribute('role', 'region');
    canvas.setAttribute('aria-keyshortcuts', 'P B E V N M Space Period R Enter + - ArrowLeft ArrowRight ArrowUp ArrowDown');
  }

  const shortcuts = {
    '#run-toggle': 'Space', '#step-once': '.', '#simulation-reset': 'R',
    '#tool-pan': 'P', '#tool-paint': 'B', '#tool-erase': 'E', '#tool-move-field': 'V',
    '#tool-place-emitter': 'N', '#tool-move-emitter': 'M'
  };
  for (const [selector, keys] of Object.entries(shortcuts)) document.querySelector(selector)?.setAttribute('aria-keyshortcuts', keys);
}

function installCanvasKeyboardStamp() {
  window.addEventListener('keydown', (event) => {
    const canvas = document.querySelector('#preview-canvas');
    if (event.target !== canvas || event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey) return;
    const editor = getActiveRecipeEditorSession();
    const renderer = getActiveWebGL2Renderer();
    if (!editor || !renderer || (editor.tool !== 'paint' && editor.tool !== 'erase')) return;
    event.preventDefault();
    try {
      editor.paintStroke([renderer.view.center], editor.tool === 'erase' ? 'erase' : 'set');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    } catch (error) {
      document.querySelector('#canvas-status').textContent = `Keyboard stamp failed: ${error?.message ?? String(error)}`;
    }
  });
}

function installExportTiming() {
  const button = document.querySelector('#export-prepare');
  if (!button || button.dataset.fw014Timing === 'true') return;
  button.dataset.fw014Timing = 'true';
  button.addEventListener('click', () => {
    const started = performance.now();
    queueMicrotask(() => {
      const elapsed = performance.now() - started;
      document.documentElement.dataset.fieldweaverCanonicalExportMs = elapsed.toFixed(3);
      const width = finiteNumber(document.querySelector('#export-width')?.value);
      const height = finiteNumber(document.querySelector('#export-height')?.value);
      if (width && height && elapsed > 0) {
        const megapixelsPerSecond = (width * height) / 1_000_000 / (elapsed / 1000);
        document.documentElement.dataset.fieldweaverCanonicalExportMegapixelsPerSecond = megapixelsPerSecond.toFixed(3);
      }
    });
  }, { capture: true });
}

function installInfiniteTiming() {
  const root = document.documentElement;
  let started = null;
  let previous = root.dataset.fieldweaverInfiniteState;
  new MutationObserver(() => {
    const state = root.dataset.fieldweaverInfiniteState;
    if (state === previous) return;
    previous = state;
    if (state === 'working') started = performance.now();
    else if (started !== null && (state === 'ready' || state === 'error' || state === 'cancelled')) {
      root.dataset.fieldweaverInfiniteEvaluationMs = (performance.now() - started).toFixed(3);
      started = null;
    }
  }).observe(root, { attributes: true, attributeFilter: ['data-fieldweaver-infinite-state'] });
}

function mountReleaseDiagnostics(editor, telemetry) {
  const panel = document.querySelector('#diagnostic-title')?.closest('.panel');
  if (!panel || panel.querySelector('#release-diagnostics')) return;
  const heading = element('h3', { id: 'release-diagnostics-title', className: 'release-diagnostics-title' }, 'Release telemetry');
  const list = element('ul', { id: 'release-diagnostics', className: 'diagnostic-list', 'aria-labelledby': 'release-diagnostics-title' });
  panel.append(heading, list);

  const refresh = () => {
    const state = editor.snapshot();
    const timeline = state.timelineDiagnostics;
    const rendererDiagnostics = getActiveWebGL2Renderer()?.diagnostics?.() ?? null;
    const root = document.documentElement.dataset;
    const simMsPerTick = telemetry.lastTicks > 0 ? telemetry.lastMs / telemetry.lastTicks : 0;
    const exportMs = finiteNumber(root.fieldweaverCanonicalExportMs);
    const exportRate = finiteNumber(root.fieldweaverCanonicalExportMegapixelsPerSecond);
    const plateMs = finiteNumber(root.fieldweaverInfiniteEvaluationMs);
    const variantCount = state.variantFamily?.variants?.length ?? 0;
    const frameMs = finiteNumber(rendererDiagnostics?.frameMs);
    const previewFps = frameMs !== null && frameMs > 0 ? 1000 / frameMs : null;
    const averageReplayTicks = timeline?.seekCount > 0 ? timeline.totalReplayTicks / timeline.seekCount : 0;
    const lines = [
      `Preview rate: ${previewFps === null ? 'not sampled' : `~${previewFps.toFixed(1)} FPS`} · last render ${frameMs === null ? 'n/a' : `${frameMs.toFixed(2)} ms`}${rendererDiagnostics?.prepareMs === undefined ? '' : ` (prepare ${rendererDiagnostics.prepareMs.toFixed(2)} / submit ${rendererDiagnostics.submitMs.toFixed(2)})`}`,
      `Simulation batch: ${telemetry.lastTicks} tick(s) / ${telemetry.lastMs.toFixed(2)} ms${telemetry.lastTicks ? ` · ${simMsPerTick.toFixed(3)} ms/tick` : ''}`,
      `Simulation totals: ${telemetry.ticks} instrumented ticks · ${state.activeAgents} active agents · ${state.depositions} retained depositions · backlog ${state.backlogTicks} ticks`,
      timeline
        ? `Replay checkpoints: ${timeline.checkpointCount}/${timeline.maxCheckpoints} · ${(timeline.checkpointBytes / 1024).toFixed(1)} KiB estimate · ${timeline.evictions} evictions`
        : 'Replay checkpoints: unavailable',
      timeline
        ? `Replay work: ${timeline.totalReplayTicks} replayed ticks across ${timeline.seekCount} seeks${timeline.seekCount ? ` · ${averageReplayTicks.toFixed(1)} ticks/seek` : ''}`
        : 'Replay work: unavailable',
      `Variant family: ${variantCount || 'none'} · comparison execution remains isolated per recipe`,
      `Infinite Plate: ${root.fieldweaverInfiniteState ?? 'idle'} · ${root.fieldweaverInfiniteChunks ?? 0} active/requested chunks · cache ${root.fieldweaverInfiniteCacheSize ?? 0}/4096 entries${plateMs === null ? '' : ` · ${plateMs.toFixed(2)} ms last evaluation`}`,
      `Canonical export: ${root.fieldweaverExportState ?? 'idle'}${exportMs === null ? '' : ` · ${exportMs.toFixed(2)} ms`}${exportRate === null ? '' : ` · ${exportRate.toFixed(2)} MP/s`} · raw RGBA ${root.fieldweaverCanonicalExportHash ?? 'not prepared'}`,
      'Mode boundary: canonical CPU simulation/replay/software raster · noncanonical WebGL2 live preview and wall-clock telemetry'
    ];
    list.replaceChildren(...lines.map((line) => element('li', {}, line)));
  };

  const button = document.querySelector('#diagnostics-refresh');
  button?.addEventListener('click', refresh);
  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [
    'data-fieldweaver-infinite-state', 'data-fieldweaver-infinite-cache-size', 'data-fieldweaver-infinite-chunks',
    'data-fieldweaver-export-state', 'data-fieldweaver-canonical-export-hash', 'data-fieldweaver-canonical-export-ms'
  ] });
  setInterval(refresh, 1000);
  refresh();
}

function install(attempt = 0) {
  const editor = getActiveRecipeEditorSession();
  const panel = document.querySelector('#diagnostic-title')?.closest('.panel');
  if (!editor || !panel) {
    if (attempt < 120) requestAnimationFrame(() => install(attempt + 1));
    return;
  }
  const telemetry = installSimulationTelemetry(editor);
  installAccessibilityFixes();
  installCanvasKeyboardStamp();
  installExportTiming();
  installInfiniteTiming();
  mountReleaseDiagnostics(editor, telemetry);
  document.documentElement.dataset.fieldweaverReleaseReady = 'true';
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', () => install(), { once: true });
else install();
