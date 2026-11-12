import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMISSION_SELECTION, assertArchivedRecipeMatchesProvenance } from '../scripts/admission-review.mjs';

test('owner admission shortlist is bounded, source-exact and not an accepted catalog mutation', () => {
  assert.equal(ADMISSION_SELECTION.length, 3);
  assert.equal(new Set(ADMISSION_SELECTION.map((x) => x.pr)).size, 3);
  assert.equal(ADMISSION_SELECTION.filter((x) => x.lane === 'ORIGINAL').length, 2);
  assert.equal(ADMISSION_SELECTION.filter((x) => x.lane === 'MUTATION').length, 1);
  for (const item of ADMISSION_SELECTION) {
    assert.match(item.head, /^[0-9a-f]{40}$/);
    assert.match(item.rgba, /^[0-9a-f]{16}$/);
    assert.match(item.provenance, /^gallery\/(originals|variants)\/[\w-]+\/[\w-]+\.provenance\.json$/);
    assert.match(item.recipe, /^gallery\/(originals|variants)\/[\w-]+\/[\w.-]+\.json$/);
    assert(!item.recipe.includes('..'));
    assert(!item.provenance.includes('..'));
    assert(item.title.length > 5);
  }
  assert.equal(new Set(ADMISSION_SELECTION.map((x) => x.rgba)).size, 3);
  assert.deepEqual(ADMISSION_SELECTION.map((x) => x.pr), [57, 50, 41]);
  assert.equal(ADMISSION_SELECTION[2].head, 'c6f5ecc0995071c45ae90a00d53ee23dc53b6641');
  assert.equal(ADMISSION_SELECTION[2].rgba, 'fd389a9bb0ce640f');
  assert(!ADMISSION_SELECTION.some((x) => [61, 62].includes(x.pr)),
    'Withdrawn/rejected artworks must not appear as active admission candidates.');
});

test('admission review rejects independently drifted or missing authored recipe archives', () => {
  const authored = {
    version: 'fw-recipe-v1',
    seed: 12345,
    fields: [{ id: 7, strength: 1024 }],
    timeline: [{ tick: 12, commandId: 1 }]
  };
  const provenance = { recipe: structuredClone(authored) };
  assert.doesNotThrow(() => assertArchivedRecipeMatchesProvenance(authored, provenance, 57));

  const reordered = {
    timeline: [{ commandId: 1, tick: 12 }],
    fields: [{ strength: 1024, id: 7 }],
    seed: 12345,
    version: 'fw-recipe-v1'
  };
  assert.doesNotThrow(() => assertArchivedRecipeMatchesProvenance(reordered, provenance, 57),
    'ordinary JSON key order does not change source identity');

  const drifted = structuredClone(authored);
  drifted.fields[0].strength = 1025;
  assert.throws(
    () => assertArchivedRecipeMatchesProvenance(drifted, provenance, 57),
    /PR #57 authored recipe differs from its verified provenance recipe/
  );
  assert.throws(
    () => assertArchivedRecipeMatchesProvenance(authored, { recipe: null }, 50),
    /PR #50 missing a valid authored or provenance recipe/
  );
  assert.throws(
    () => assertArchivedRecipeMatchesProvenance([], provenance, 57),
    /PR #57 missing a valid authored or provenance recipe/
  );
});
