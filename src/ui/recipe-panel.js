import { getActiveRecipeEditorSession } from '../editor/index.js';

function element(tag, attributes = {}, text = '') {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') node.className = value;
    else node.setAttribute(key, value);
  }
  if (text) node.textContent = text;
  return node;
}

function downloadRecipe(editor) {
  const text = editor.exportRecipeJson();
  const hash = editor.authoringHash();
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = element('a', { href: url, download: `fieldweaver-${hash}.fwrecipe.json` });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return hash;
}

function refreshApplicationUi() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
}

export function mountRecipePanel(parent) {
  if (!(parent instanceof HTMLElement)) throw new TypeError('Recipe panel parent must be an HTMLElement.');
  const panel = element('section', { className: 'panel', 'aria-labelledby': 'recipe-title' });
  panel.append(element('h2', { id: 'recipe-title' }, 'Recipe persistence'));
  panel.append(element('p', { className: 'workspace-note' }, 'Save/load complete versioned recipes. Import validates the whole recipe before replacing live work.'));
  const save = element('button', { id: 'recipe-save', type: 'button', className: 'button' }, 'Save recipe');
  const load = element('button', { id: 'recipe-load', type: 'button', className: 'button' }, 'Load recipe');
  const file = element('input', {
    id: 'recipe-file',
    type: 'file',
    accept: '.json,.fwrecipe.json,application/json',
    'aria-label': 'Choose FIELDWEAVER recipe JSON'
  });
  file.hidden = true;
  const buttons = element('div', { className: 'button-grid' });
  buttons.append(save, load);
  const status = element('output', { id: 'recipe-status', className: 'canvas-status', 'aria-live': 'polite' }, 'Ready');
  panel.append(buttons, file, status);
  parent.append(panel);

  const getEditor = () => {
    const editor = getActiveRecipeEditorSession();
    if (!editor) throw new Error('Recipe-aware editor is not initialized yet.');
    return editor;
  };

  save.addEventListener('click', () => {
    try {
      const hash = downloadRecipe(getEditor());
      status.value = `Saved ${hash}`;
      status.textContent = status.value;
    } catch (error) {
      status.value = `Save failed: ${error?.message ?? String(error)}`;
      status.textContent = status.value;
    }
  });

  load.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const selected = file.files?.[0];
    if (!selected) return;
    try {
      const editor = getEditor();
      const text = await selected.text();
      editor.importRecipeJson(text);
      refreshApplicationUi();
      const hash = editor.authoringHash();
      document.documentElement.dataset.fieldweaverCanonicalRecipeHash = hash;
      document.documentElement.dataset.fieldweaverRecipeCommands = String(editor.snapshot().commandCount);
      status.value = `Loaded ${hash}`;
      status.textContent = status.value;
    } catch (error) {
      status.value = `Load rejected: ${error?.message ?? String(error)}`;
      status.textContent = status.value;
    } finally {
      file.value = '';
    }
  });

  return Object.freeze({ panel, save, load, file, status });
}

function mountWhenReady(attempt = 0) {
  const parent = document.querySelector('.editor-sidebar');
  if (parent) {
    mountRecipePanel(parent);
    return;
  }
  if (attempt < 120) requestAnimationFrame(() => mountWhenReady(attempt + 1));
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => mountWhenReady(), { once: true });
} else {
  mountWhenReady();
}
