import { getActiveRecipeEditorSession } from '../editor/index.js';
import { BUILTIN_PRESETS, getBuiltinPreset } from '../presets/index.js';

function element(tag, attributes = {}, text = '') {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') node.className = value;
    else node.setAttribute(key, value);
  }
  if (text) node.textContent = text;
  return node;
}

function publishPresetMetadata(preset) {
  document.documentElement.dataset.fieldweaverPresetId = preset.id;
  document.documentElement.dataset.fieldweaverPresetRecipeHash = preset.recipeHash;
  document.documentElement.dataset.fieldweaverPresetTargetTick = String(preset.targetTick);
}

export function mountPresetPanel(parent) {
  if (!(parent instanceof HTMLElement)) throw new TypeError('Preset panel parent must be an HTMLElement.');
  const panel = element('section', { className: 'panel preset-panel', 'aria-labelledby': 'preset-title' });
  panel.append(element('h2', { id: 'preset-title' }, 'Built-in presets'));
  panel.append(element('p', { className: 'workspace-note' }, 'Deterministic release recipes covering operators, materials, LUT logic, timeline intervention, lineage, and Infinite Plate framing.'));

  const label = element('label', { className: 'control-label' });
  const select = element('select', { id: 'preset-select', 'aria-describedby': 'preset-description' });
  for (const preset of BUILTIN_PRESETS) select.append(element('option', { value: preset.id }, preset.name));
  label.append(element('span', {}, 'Preset'), select);

  const description = element('p', { id: 'preset-description', className: 'workspace-note' });
  const coverage = element('p', { id: 'preset-coverage', className: 'workspace-note' });
  const load = element('button', { id: 'preset-load', type: 'button', className: 'button' }, 'Load preset');
  const status = element('output', { id: 'preset-status', className: 'hash-readout', 'aria-live': 'polite' }, 'Ready');
  panel.append(label, description, coverage, load, status);

  const recipePanel = parent.querySelector('#recipe-title')?.closest('.panel');
  if (recipePanel) parent.insertBefore(panel, recipePanel);
  else parent.prepend(panel);

  const getEditor = () => {
    const editor = getActiveRecipeEditorSession();
    if (!editor || typeof editor.adoptRecipe !== 'function') throw new Error('Recipe-aware editor is not initialized yet.');
    return editor;
  };

  const refresh = () => {
    const preset = getBuiltinPreset(select.value);
    description.textContent = `${preset.description} Target tick ${preset.targetTick}.`;
    coverage.textContent = `Covers: ${preset.coverage.join(' · ')}`;
    publishPresetMetadata(preset);
    return preset;
  };

  select.addEventListener('change', refresh);
  load.addEventListener('click', () => {
    try {
      const preset = refresh();
      const editor = getEditor();
      editor.adoptRecipe(preset.recipe);
      window.dispatchEvent(new CustomEvent('fieldweaver:recipe-adopted', { detail: { source: 'preset', id: preset.id } }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      status.value = `Loaded ${preset.name} · ${preset.recipeHash}`;
      status.textContent = status.value;
      publishPresetMetadata(preset);
    } catch (error) {
      status.value = `Preset rejected: ${error?.message ?? String(error)}`;
      status.textContent = status.value;
    }
  });

  refresh();
  panel.dataset.ready = 'true';
  return Object.freeze({ panel, select, load, status, description, coverage });
}

function mountWhenReady(attempt = 0) {
  const parent = document.querySelector('.editor-sidebar');
  if (parent) {
    mountPresetPanel(parent);
    return;
  }
  if (attempt < 120) requestAnimationFrame(() => mountWhenReady(attempt + 1));
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', () => mountWhenReady(), { once: true });
else mountWhenReady();
