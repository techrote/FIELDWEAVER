import { canonicalHash } from '../core/canonical.js';
import {
  EDITOR_VERSION,
  DEFAULT_EDITOR_SEED,
  EDITOR_TOOLS,
  EDITOR_SPEEDS,
  worldPositionFromUnits,
  worldPositionToUnits,
  EditorSession as BaseEditorSession
} from './model.js';

export {
  EDITOR_VERSION,
  DEFAULT_EDITOR_SEED,
  EDITOR_TOOLS,
  EDITOR_SPEEDS,
  worldPositionFromUnits,
  worldPositionToUnits
};
export { LUT_EDITOR_VERSION, LutEditorSession as LegacyLutEditorSession } from './lut-session.js';
export {
  RECIPE_EDITOR_VERSION,
  RecipeEditorSession,
  RecipeEditorSession as LutEditorSession,
  getActiveRecipeEditorSession
} from './recipe-session.js';

export class EditorSession extends BaseEditorSession {
  authoringHash() {
    if (this._cachedAuthoringRevision === this._authoringRevision && this._cachedAuthoringHash) return this._cachedAuthoringHash;
    const hash = canonicalHash({
      version: EDITOR_VERSION,
      rootSeed: this.rootSeed,
      fields: this.fieldCollection.toCanonical(),
      materials: this.simulation.materials,
      emitters: this.simulation.emitters
    });
    this._cachedAuthoringRevision = this._authoringRevision;
    this._cachedAuthoringHash = hash;
    return hash;
  }
}
