import { getActiveRecipeEditorSession } from '../editor/index.js';
import { createWebGL2Renderer } from '../renderer/index.js';

function element(tag, attributes = {}, text = '') {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value);
  }
  if (text) node.textContent = text;
  return node;
}

function labeled(labelText, control) {
  const label = element('label', { className: 'control-label' });
  label.append(element('span', {}, labelText), control);
  return label;
}

function option(value, label) {
  return element('option', { value: String(value) }, label);
}

function activeEditor() {
  const editor = getActiveRecipeEditorSession();
  return editor && typeof editor.generateVariants === 'function' ? editor : null;
}

function requestMainRefresh() {
  window.dispatchEvent(new Event('fieldweaver-editor-refresh'));
}

function makePanel(sidebar) {
  const panel = element('section', { className: 'panel mutation-panel', 'aria-labelledby': 'mutation-title' });
  panel.append(element('h2', { id: 'mutation-title' }, 'Mutation & variants'));
  panel.append(element('p', { className: 'workspace-note' }, 'Fork deterministic siblings from the current recipe. Mutation selection and magnitude are derived only from the visible mutation seed, sibling index, scope, and intensity.'));

  const mutationSeed = element('input', { id: 'mutation-seed', type: 'number', min: '0', max: '4294967295', step: '1', value: '11011' });
  const siblingCount = element('input', { id: 'mutation-count', type: 'number', min: '1', max: '8', step: '1', value: '4' });
  const scope = element('select', { id: 'mutation-scope' });
  for (const value of ['all', 'parameters', 'fields', 'emitters', 'order', 'lut', 'seed']) scope.append(option(value, value));
  const intensity = element('select', { id: 'mutation-intensity' });
  for (const value of ['subtle', 'medium', 'bold']) intensity.append(option(value, value));
  intensity.value = 'medium';
  const operationCount = element('input', { id: 'mutation-operation-count', type: 'number', min: '1', max: '6', step: '1', value: '3' });
  panel.append(
    labeled('Mutation seed', mutationSeed),
    labeled('Sibling count', siblingCount),
    labeled('Scope', scope),
    labeled('Intensity', intensity),
    labeled('Operations / child', operationCount)
  );

  const generate = element('button', { id: 'mutation-generate', className: 'button', type: 'button' }, 'Fork siblings');
  const variantSelect = element('select', { id: 'mutation-variant-select', 'aria-label': 'Selected mutation variant' });
  const restore = element('button', { id: 'mutation-restore', className: 'button', type: 'button' }, 'Restore selected');
  const buttons = element('div', { className: 'button-grid' });
  buttons.append(generate, restore);
  panel.append(buttons, labeled('Variant', variantSelect));

  const lineage = element('output', { id: 'mutation-lineage', className: 'hash-readout', 'aria-live': 'polite' }, 'No variant family yet.');
  const diff = element('pre', { id: 'mutation-diff', className: 'mutation-diff', tabindex: '0' }, 'Generate siblings to inspect exact normalized recipe changes.');
  panel.append(element('p', { className: 'control-label' }, 'Lineage'), lineage, element('p', { className: 'control-label' }, 'Exact recipe diff'), diff);

  const compareTick = element('input', { id: 'mutation-compare-tick', type: 'number', min: '0', max: '4294967295', step: '1', value: '40' });
  const compare = element('button', { id: 'mutation-compare', className: 'button', type: 'button' }, 'Compare family');
  const comparison = element('div', { id: 'mutation-comparison', className: 'variant-comparison-grid', 'aria-live': 'polite' });
  const status = element('output', { id: 'mutation-status', className: 'canvas-status', 'aria-live': 'polite' }, 'Ready.');
  panel.append(labeled('Comparison tick', compareTick), compare, comparison, status);
  sidebar.append(panel);

  let family = null;
  let comparisonRenderers = [];

  const disposeComparison = () => {
    for (const renderer of comparisonRenderers) renderer.dispose();
    comparisonRenderers = [];
    comparison.replaceChildren();
  };

  const selectedSummary = () => family?.variants.find((entry) => entry.id === variantSelect.value) ?? null;

  const updateSelection = () => {
    const entry = selectedSummary();
    if (!entry) return;
    if (entry.id === 'parent') {
      lineage.textContent = `Parent recipe ${entry.recipeHash}`;
      diff.textContent = 'Parent baseline — no mutation diff.';
      return;
    }
    lineage.textContent = `${entry.parentRecipeHash} → ${entry.childIdentity} · recipe ${entry.recipeHash} · seed ${entry.childSeed} · mutation seed ${entry.mutationSeed} · sibling ${entry.siblingIndex}`;
    diff.textContent = entry.diff.length === 0
      ? 'No semantic recipe differences.'
      : entry.diff.map((change) => `${change.path}\n  - ${JSON.stringify(change.before)}\n  + ${JSON.stringify(change.after)}`).join('\n');
  };

  const loadFamily = (nextFamily) => {
    family = nextFamily;
    variantSelect.replaceChildren();
    for (const entry of family?.variants ?? []) {
      variantSelect.append(option(entry.id, `${entry.label} · ${entry.recipeHash}`));
    }
    if (family?.selectedVariantId) variantSelect.value = family.selectedVariantId;
    updateSelection();
    document.documentElement.dataset.fieldweaverVariantCount = String(Math.max(0, (family?.variants.length ?? 1) - 1));
  };

  generate.addEventListener('click', () => {
    try {
      const editor = activeEditor();
      if (!editor) throw new Error('Mutation editor is not ready.');
      disposeComparison();
      const next = editor.generateVariants({
        mutationSeed: Number(mutationSeed.value),
        count: Number(siblingCount.value),
        scope: scope.value,
        intensity: intensity.value,
        operationCount: Number(operationCount.value)
      });
      loadFamily(next);
      status.textContent = `Generated ${next.variants.length - 1} deterministic siblings from ${next.parentRecipeHash}.`;
      requestMainRefresh();
    } catch (error) {
      status.textContent = `${error.name}: ${error.message}`;
    }
  });

  variantSelect.addEventListener('change', () => {
    const editor = activeEditor();
    if (editor && variantSelect.value) editor.selectVariant(variantSelect.value);
    updateSelection();
  });

  restore.addEventListener('click', () => {
    try {
      const editor = activeEditor();
      if (!editor || !variantSelect.value) throw new Error('Select a generated variant first.');
      editor.restoreVariant(variantSelect.value);
      status.textContent = `Restored ${variantSelect.options[variantSelect.selectedIndex].textContent}. Family snapshots remain immutable.`;
      requestMainRefresh();
    } catch (error) {
      status.textContent = `${error.name}: ${error.message}`;
    }
  });

  compare.addEventListener('click', () => {
    try {
      const editor = activeEditor();
      if (!editor) throw new Error('Mutation editor is not ready.');
      const tick = Number(compareTick.value);
      const results = editor.createVariantComparison(null, tick);
      disposeComparison();
      for (const result of results) {
        const card = element('section', { className: 'variant-preview-card', dataset: { variantId: result.id } });
        card.append(element('h3', {}, result.label));
        const canvas = element('canvas', { className: 'variant-preview-canvas', width: '300', height: '180', 'aria-label': `${result.label} comparison preview at tick ${tick}` });
        const hashes = element('code', { className: 'hash-readout' }, `${result.resultHash} · tick ${tick}`);
        card.append(canvas, hashes);
        comparison.append(card);
        const renderer = createWebGL2Renderer(canvas, {
          maxPreviewDepositions: 50_000,
          viewport: {
            widthCssPx: canvas.clientWidth || 300,
            heightCssPx: canvas.clientHeight || 180,
            devicePixelRatio: window.devicePixelRatio || 1,
            zoom: 1,
            center: result.recipe.framing.center
          }
        });
        renderer.render({
          depositions: result.replay.simulation.depositions,
          fieldCollection: result.replay.fieldCollection,
          emitters: result.replay.simulation.emitters,
          showOverlays: false
        });
        comparisonRenderers.push(renderer);
      }
      document.documentElement.dataset.fieldweaverVariantComparisonCount = String(results.length);
      document.documentElement.dataset.fieldweaverVariantComparisonTick = String(tick);
      status.textContent = `Compared ${results.length} independently replayed variants at tick ${tick}.`;
    } catch (error) {
      disposeComparison();
      status.textContent = `${error.name}: ${error.message}`;
    }
  });

  window.addEventListener('fieldweaver-editor-state', (event) => {
    const snapshot = event.detail;
    if (!snapshot?.variantFamily) return;
    if (!family || family.parentRecipeHash !== snapshot.variantFamily.parentRecipeHash) loadFamily(snapshot.variantFamily);
  });

  const editor = activeEditor();
  if (editor?.variantFamilySnapshot()) loadFamily(editor.variantFamilySnapshot());
  document.documentElement.dataset.fieldweaverMutationPanel = 'ready';
}

function mountWhenReady(attempt = 0) {
  const sidebar = document.querySelector('.editor-sidebar');
  if (sidebar && activeEditor()) {
    makePanel(sidebar);
    return;
  }
  if (attempt < 120) setTimeout(() => mountWhenReady(attempt + 1), 25);
}

mountWhenReady();
