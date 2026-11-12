import { getBuiltinPreset } from '../presets/index.js';
import { parseRecipe, recipeHash, serializeRecipe } from '../recipe/index.js';

// Read-only gallery-to-editor handoff. The downloaded JSON is an ordinary
// fw-recipe-v1 file, not an exhibition wrapper or an export provenance receipt.
// A gallery selection must not adopt a recipe or alter the working simulation.
export function buildAcceptedRecipeHandoff(id) {
  const preset = getBuiltinPreset(id);
  const json = serializeRecipe(preset.recipe);
  const roundtrip = parseRecipe(json);
  const hash = recipeHash(roundtrip);
  if (hash !== preset.recipeHash ||
      recipeHash(preset.recipe) !== hash ||
      roundtrip.seed !== preset.recipe.seed) {
    throw new Error('Accepted gallery recipe changed during handoff; refusing download.');
  }
  return Object.freeze({
    id: preset.id,
    filename: 'fieldweaver-' + preset.id + '-' + hash + '.fwrecipe.json',
    json,
    recipeHash: hash,
    seed: roundtrip.seed,
    targetTick: preset.targetTick,
    crop: Object.freeze({
      ...preset.exportCrop,
      center: Object.freeze({ ...preset.exportCrop.center })
    })
  });
}
