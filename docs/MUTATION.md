# Deterministic mutation and lineage — FW-011

FIELDWEAVER mutation is recipe transformation, not simulation-state mutation. A parent recipe is normalized and hashed, copied into detached working data, transformed with explicit deterministic operators, validated through the ordinary `fw-recipe-v1` contract, and only then exposed as a child variant.

## Public contract

`src/mutation/index.js` exports the `fw-mutation-v1` API:

- `normalizeMutationConfig()` validates the explicit mutation seed, sibling index, scope, intensity and requested operation count.
- `mutateRecipe(parent, config)` returns a validated normalized child plus its lineage identity, canonical recipe hash, operation records and exact semantic recipe diff.
- `createSiblingVariants(parent, config)` derives independently identified siblings by incrementing the explicit sibling index.
- `diffRecipes(parent, child)` compares normalized recipes without lineage noise by default.
- `readMutationLineage(recipe)` decodes FW-011 provenance from any saved/reloaded child.

The supported scopes are `all`, `parameters`, `fields`, `emitters`, `order`, `lut`, and `seed`. Intensities are `subtle`, `medium`, and `bold`. No operator calls `Math.random()`, reads wall-clock time, or depends on DOM/GPU state.

## Identity and persistence

The existing FW-009 recipe schema already reserved an optional lineage envelope:

```text
lineage = {
  parentRecipeHash,
  childSeed,
  operations[]
}
```

FW-011 keeps that envelope byte-compatible instead of revving `fw-recipe-v1`. The first operation of a new mutation lineage is a versioned `fw-lineage-v1` identity record containing `childIdentity`, `mutationSeed`, and `siblingIndex`; the remaining entries are the explicit `fw-mutation-v1` transformation operations. This lets older FW-009 readers preserve the lineage payload while FW-011 readers can interpret it precisely.

`childIdentity` is a canonical provenance identity derived from:

- lineage version;
- canonical parent recipe hash;
- explicit mutation seed;
- sibling index;
- resulting child seed; and
- ordered mutation operation records.

It deliberately does **not** include the enclosing identity record, avoiding a self-referential hash. `childRecipeHash` is the separate canonical hash of the fully normalized child recipe, including its persisted lineage. Save/load therefore preserves both ancestry and exact recipe identity.

A child stores the parent's hash, never a mutable reference to the parent editor model. A variant family in `MutationEditorSession` also stores detached normalized recipe snapshots. Restoring and then editing a child can establish a new authored state, but it cannot rewrite the saved parent or sibling snapshots.

## PRNG/substream rules

Mutation selection is driven from the explicit `mutationSeed`, canonical parent/working seed, sibling index and stable numeric stream tags. Operator magnitudes use dedicated tagged PRNG streams. The same normalized parent plus the same mutation config therefore yields byte-for-byte identical normalized child JSON and identical recipe hashes.

Sibling indexes are part of stream derivation and lineage identity. Creating or comparing a sibling never advances the parent's simulation PRNG or changes parent canonical state. Mutation works only on a detached recipe clone.

The sibling-seed operator uses `deriveSeed(parentSeed, mutationSeed, siblingIndex, streamTag, ordinal)` and records that derivation explicitly.

## Operators and bounds

`perturb-material-parameter` changes a validated integer material parameter. Magnitudes are proportional to the existing absolute value (1/16 subtle, 1/8 medium, 1/4 bold, minimum one integer unit) and are clamped to the canonical material range.

`adjust-field-strength-scale` alters a deterministic field strength/vector component or positive transform scale using the same intensity ratios. Signed strengths/vectors clamp to int32; non-negative amplitudes clamp at zero; scales remain positive.

`move-emitter` translates one emitter origin by an integer Q16.16 delta. Maximum axis displacement is 4, 16 or 64 world units for subtle, medium or bold mutation respectively. Chunk normalization uses the canonical coordinate helper.

`swap-adjacent-fields` swaps one adjacent pair in the canonical field order and reorders serialized layers to match.

`substitute-lut` replaces one mapping's LUT ID with a deterministic compatible alternative. Colour mappings require RGB channels; scalar/behaviour mappings require the referenced channel. A LUT scope with no compatible substitute is rejected explicitly.

`derive-sibling-seed` derives and records a new root seed from the visible mutation seed and sibling index.

For `all`, applicable operator types are deterministically shuffled and the requested number (bounded by the applicable set) is used. Scope-specific mutation uses only operators appropriate to that scope.

## Validation and rejection

Bounds above are deterministic repairs: an out-of-range arithmetic result is clamped according to the documented canonical contract and the operation record says which repair rule was used. After all selected operations, the complete child is passed through ordinary `createRecipe()` normalization/validation before adoption.

If an operator cannot apply, or final validation fails, mutation throws `MutationRejectedError` with a stable code and useful details. Invalid children are never silently adopted. Tests cover an inapplicable LUT scope as an explicit rejection.

## Variant UI and comparison isolation

The **Mutation & variants** panel can:

1. choose explicit mutation seed, sibling count, scope, intensity and operation count;
2. fork multiple siblings from the current recipe;
3. navigate parent and siblings;
4. inspect lineage hashes and exact normalized recipe differences;
5. restore any stored variant; and
6. render an A/B or small-grid family comparison at an explicit target tick.

Comparison uses `MutationEditorSession.createVariantComparison()`. Every displayed variant creates its own `RecipeReplay` and canonical simulation instance, replays forward to the target tick, then passes only that replay's deposition/field/emitter view to a separate existing WebGL2 preview renderer. Comparison renderers therefore share no mutable canonical simulation state. GPU output remains noncanonical, exactly like the main live preview.

## Deterministic fixtures and tests

`fixtures/fw-011-golden.json` locks the parent recipe hash, lineage child identity, final child recipe hash, operation hash, diff hash and exact selected operator order for a representative six-operator mutation.

`tests/mutation.test.mjs` additionally proves:

- byte-equivalent repeated mutation;
- parent immutability;
- all required operators and scope-specific paths;
- explicit invalid-scope rejection;
- save/reload lineage and replay equivalence;
- immutable stored family snapshots; and
- independent replay state across a four-way comparison.

Browser smoke coverage exercises sibling generation, exact diff visibility, restore/navigation and independent comparison rendering in both required WebGL2 browsers.
