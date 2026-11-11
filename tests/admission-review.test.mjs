import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMISSION_SELECTION } from '../scripts/admission-review.mjs';

test('owner admission shortlist is bounded, source-exact and not an accepted catalog mutation', () => {
  assert.equal(ADMISSION_SELECTION.length, 4);
  assert.equal(new Set(ADMISSION_SELECTION.map((x) => x.pr)).size, 4);
  assert.equal(ADMISSION_SELECTION.filter((x) => x.lane === 'ORIGINAL').length, 2);
  assert.equal(ADMISSION_SELECTION.filter((x) => x.lane === 'MUTATION').length, 2);
  for (const item of ADMISSION_SELECTION) {
    assert.match(item.head, /^[0-9a-f]{40}$/);
    assert.match(item.rgba, /^[0-9a-f]{16}$/);
    assert.match(item.provenance, /^gallery\/(originals|variants)\/[\w-]+\/[\w-]+\.provenance\.json$/);
    assert(!item.provenance.includes('..'));
    assert(item.title.length > 5);
  }
  assert.equal(new Set(ADMISSION_SELECTION.map((x) => x.rgba)).size, 4);
});
