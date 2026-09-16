import { getActiveRecipeEditorSession } from '../editor/index.js';

export function mountRecipePanel(parent) {
  if (!(parent instanceof HTMLElement)) throw new TypeError('Recipe panel parent must be an HTMLElement.');
  const editor = getActiveRecipeEditorSession();
  if (!editor) throw new Error('Recipe-aware editor is not initialized yet.');
  return Object.freeze({ parent, editor });
}
