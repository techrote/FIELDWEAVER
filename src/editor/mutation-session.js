import { canonicalStringify } from '../core/canonical.js';
import { createSiblingVariants, readMutationLineage } from '../mutation/index.js';
import { createRecipe, createRecipeReplay, recipeHash } from '../recipe/index.js';
import { TimelineEditorSession } from './timeline-session.js';

export const MUTATION_EDITOR_VERSION = 'fw-editor-mutation-v1';
export const DEFAULT_VARIANT_COUNT = 4;
export const MAX_VARIANT_COUNT = 8;

function cloneRecipe(recipe) {
  return createRecipe(JSON.parse(canonicalStringify(recipe)));
}

function variantSummary(entry) {
  return Object.freeze({
    id: entry.id,
    label: entry.label,
    recipeHash: entry.recipeHash,
    childIdentity: entry.childIdentity,
    parentRecipeHash: entry.parentRecipeHash,
    mutationSeed: entry.mutationSeed,
    siblingIndex: entry.siblingIndex,
    childSeed: entry.recipe.seed,
    diff: Object.freeze(entry.diff.map((item) => Object.freeze({ ...item }))),
    operations: Object.freeze(entry.operations.map((item) => Object.freeze({ ...item })))
  });
}

export class MutationEditorSession extends TimelineEditorSession {
  constructor(options = {}) {
    super(options);
    this._variantFamily = null;
    this._selectedVariantId = null;
  }

  _familyEntry(id) {
    if (!this._variantFamily) throw new RangeError('No variant family has been generated.');
    const entry = this._variantFamily.entries.find((candidate) => candidate.id === id);
    if (!entry) throw new RangeError(`Unknown variant ID ${String(id)}.`);
    return entry;
  }

  generateVariants(input = {}) {
    const parent = cloneRecipe(this.currentRecipe());
    const parentRecipeHash = recipeHash(parent);
    const count = input.count ?? DEFAULT_VARIANT_COUNT;
    if (!Number.isInteger(count) || count < 1 || count > MAX_VARIANT_COUNT) {
      throw new RangeError(`Variant count must be an integer in [1, ${MAX_VARIANT_COUNT}].`);
    }
    const children = createSiblingVariants(parent, { ...input, count });
    const parentEntry = Object.freeze({
      id: 'parent',
      label: 'Parent',
      recipe: parent,
      recipeHash: parentRecipeHash,
      childIdentity: null,
      parentRecipeHash: null,
      mutationSeed: null,
      siblingIndex: null,
      diff: Object.freeze([]),
      operations: Object.freeze([])
    });
    const childEntries = children.map((child, index) => Object.freeze({
      id: child.childIdentity,
      label: `Sibling ${index + 1}`,
      recipe: cloneRecipe(child.recipe),
      recipeHash: child.childRecipeHash,
      childIdentity: child.childIdentity,
      parentRecipeHash: child.parentRecipeHash,
      mutationSeed: child.config.mutationSeed,
      siblingIndex: child.config.siblingIndex,
      diff: child.diff,
      operations: child.operations
    }));
    this._variantFamily = Object.freeze({
      parentRecipeHash,
      createdFromTick: this.simulation.tick,
      entries: Object.freeze([parentEntry, ...childEntries])
    });
    this._selectedVariantId = childEntries[0]?.id ?? 'parent';
    return this.variantFamilySnapshot();
  }

  variantFamilySnapshot() {
    if (!this._variantFamily) return null;
    return Object.freeze({
      version: MUTATION_EDITOR_VERSION,
      parentRecipeHash: this._variantFamily.parentRecipeHash,
      createdFromTick: this._variantFamily.createdFromTick,
      selectedVariantId: this._selectedVariantId,
      variants: Object.freeze(this._variantFamily.entries.map(variantSummary))
    });
  }

  selectVariant(id) {
    this._familyEntry(id);
    this._selectedVariantId = id;
    return id;
  }

  restoreVariant(id = this._selectedVariantId) {
    const entry = this._familyEntry(id);
    const family = this._variantFamily;
    super.adoptRecipe(entry.recipe);
    this._variantFamily = family;
    this._selectedVariantId = id;
    return this.currentRecipe();
  }

  createVariantComparison(ids = null, targetTick = this.simulation.tick) {
    if (!Number.isInteger(targetTick) || targetTick < 0 || targetTick > 0xffffffff) throw new RangeError('Comparison target tick must be a uint32 integer.');
    if (!this._variantFamily) throw new RangeError('No variant family has been generated.');
    const requested = ids === null
      ? this._variantFamily.entries.slice(0, Math.min(4, this._variantFamily.entries.length)).map((entry) => entry.id)
      : ids;
    if (!Array.isArray(requested) || requested.length < 2 || requested.length > 4) {
      throw new RangeError('Variant comparison requires 2–4 variant IDs.');
    }
    const unique = new Set(requested);
    if (unique.size !== requested.length) throw new RangeError('Variant comparison IDs must be unique.');
    return Object.freeze(requested.map((id) => {
      const entry = this._familyEntry(id);
      const replay = createRecipeReplay(entry.recipe, {
        capacity: this.agentCapacity,
        maxDepositions: this.maxDepositions
      });
      replay.runToTick(targetTick);
      return Object.freeze({
        id: entry.id,
        label: entry.label,
        recipe: entry.recipe,
        replay,
        tick: targetTick,
        stateHash: replay.stateHash(),
        depositionHash: replay.depositionHash(),
        resultHash: replay.resultHash()
      });
    }));
  }

  adoptRecipe(recipeInput) {
    const adopted = super.adoptRecipe(recipeInput);
    const lineage = readMutationLineage(adopted);
    if (!this._variantFamily && lineage) this._selectedVariantId = lineage.childIdentity;
    return adopted;
  }

  snapshot(backlogTicks = 0) {
    const base = super.snapshot(backlogTicks);
    const lineage = readMutationLineage(this.currentRecipe());
    return Object.freeze({
      ...base,
      mutationVersion: MUTATION_EDITOR_VERSION,
      mutationLineage: lineage,
      variantFamily: this.variantFamilySnapshot()
    });
  }
}
