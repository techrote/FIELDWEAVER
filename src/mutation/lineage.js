import { createRecipe } from '../recipe/index.js';
import { LINEAGE_VERSION, MUTATION_VERSION } from './model.js';

export function readMutationLineage(recipeInput) {
  const recipe = createRecipe(recipeInput);
  const lineage = recipe.lineage;
  if (!lineage) return null;
  const identity = lineage.operations.find((operation) => operation?.type === 'lineage-identity');
  if (!identity) return null;
  if (identity.version !== LINEAGE_VERSION) throw new RangeError(`Unsupported mutation lineage version: ${String(identity.version)}.`);
  if (typeof identity.childIdentity !== 'string' || !/^[0-9a-f]{16}$/.test(identity.childIdentity)) {
    throw new RangeError('Mutation lineage child identity must be a 16-character lowercase canonical hash.');
  }
  return Object.freeze({
    version: identity.version,
    mutationVersion: MUTATION_VERSION,
    parentRecipeHash: lineage.parentRecipeHash,
    childIdentity: identity.childIdentity,
    mutationSeed: identity.mutationSeed >>> 0,
    siblingIndex: identity.siblingIndex >>> 0,
    childSeed: lineage.childSeed >>> 0,
    operations: Object.freeze(lineage.operations.filter((operation) => operation !== identity))
  });
}
