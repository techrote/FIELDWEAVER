import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_PRESETS } from '../src/presets/index.js';
import { recipeHash } from '../src/recipe/index.js';
import { renderVisualIndexProof } from '../src/ui/exhibition-visual-index-model.js';
import { acceptedRecipeLedger, compareAcceptedRecipeLedgers, verifyLedgerCanonicalImage, RECIPE_LEDGER_VERSION } from '../src/ui/exhibition-recipe-ledger.js';

test('the authoring score uses only accepted immutable recipes and preserves their identities', () => {
  const before = BUILTIN_PRESETS.map((preset) => recipeHash(preset.recipe));
  for (const preset of BUILTIN_PRESETS) {
    const ledger = acceptedRecipeLedger(preset.id);
    const proof = renderVisualIndexProof(preset.id);
    assert.equal(ledger.version, RECIPE_LEDGER_VERSION);
    assert.equal(ledger.recipeHash, proof.recipeHash);
    assert.equal(ledger.recipeHash, preset.recipeHash);
    assert.match(proof.rawRgbaHash, /^[0-9a-f]{16}$/);
    assert.equal(ledger.rows.length, 10);
    assert(ledger.rows.every((row) => /^[0-9a-f]{16}$/.test(row.fingerprint)));
    assert.equal(Object.isFrozen(ledger), true);
    assert.equal(Object.isFrozen(ledger.rows), true);
    assert.equal(Object.isFrozen(ledger.commands), true);
    assert.deepEqual(ledger.commands.map((command) => command.id),
      [...preset.recipe.commands].sort((a, b) => a.tick - b.tick || a.id - b.id).map((command) => command.id));
  }
  assert.deepEqual(BUILTIN_PRESETS.map((preset) => recipeHash(preset.recipe)), before);
  assert.throws(() => acceptedRecipeLedger('candidate-on-unmerged-pr'), /Unknown FIELDWEAVER preset/);
});

test('A/B analysis detects true authoring differences without inferring image differences', () => {
  const weave = acceptedRecipeLedger('first-weave');
  const atlas = acceptedRecipeLedger('operator-atlas');
  const pulse = acceptedRecipeLedger('timeline-pulse');
  const identical = compareAcceptedRecipeLedgers(atlas, acceptedRecipeLedger('operator-atlas'));
  assert(identical.every((row) => row.relation === 'Identical'));
  const single = compareAcceptedRecipeLedgers(atlas);
  assert(single.every((row) => row.relation === 'Single work' && row.right === null));
  const diff = compareAcceptedRecipeLedgers(weave, atlas);
  assert.equal(diff.find((row) => row.key === 'fields').relation, 'Different');
  assert.equal(diff.find((row) => row.key === 'materials').relation, 'Identical');
  assert.equal(diff.find((row) => row.key === 'tick').relation, 'Different');
  assert.equal(diff.find((row) => row.key === 'commands').relation, 'Identical');
  const timeline = compareAcceptedRecipeLedgers(atlas, pulse);
  assert.equal(timeline.find((row) => row.key === 'commands').relation, 'Different');
  assert.equal(pulse.commands.length, 6);
  assert.deepEqual(pulse.commands.map((event) => event.tick), [8, 12, 18, 24, 28, 34]);
  assert(pulse.commands.every((event) => event.canonical.includes('"tick"')));
  assert.throws(() => compareAcceptedRecipeLedgers(null), /Only accepted/);
  assert.throws(() => compareAcceptedRecipeLedgers(atlas, { version: 'proxy', rows: [] }), /Only accepted/);
});

test('the accepted far-chunk mutation exposes its actual lineage and crop', () => {
  const inherited = acceptedRecipeLedger('infinite-lineage');
  const lineage = inherited.rows.find((row) => row.key === 'lineage');
  const crop = inherited.rows.find((row) => row.key === 'crop');
  assert.match(lineage.description, /Parent [0-9a-f]{16}/);
  assert.match(crop.description, /centre \(12, -7,/);
  assert.equal(inherited.commands.length, 0);
});

test('recipe ledger independently validates decoded pixels, not a DOM-supplied hash', () => {
  for (const preset of BUILTIN_PRESETS) {
    const proof = renderVisualIndexProof(preset.id);
    const valid = { id: preset.id, url: 'blob:verified-local', rawRgbaHash: proof.rawRgbaHash, png: proof.png };
    assert.deepEqual(verifyLedgerCanonicalImage(valid), { id: preset.id, rawRgbaHash: proof.rawRgbaHash });
    assert.throws(() => verifyLedgerCanonicalImage({ ...valid, rawRgbaHash: '0000000000000000' }), /identity mismatch/);
    assert.throws(() => verifyLedgerCanonicalImage({ ...valid, id: 'unmerged-original' }), /accepted live CPU/);
    assert.throws(() => verifyLedgerCanonicalImage({ ...valid, url: 'https://external.invalid/' }), /accepted live CPU/);
    const altered = proof.png.slice();
    altered[altered.length - 1] ^= 1;
    assert.throws(() => verifyLedgerCanonicalImage({ ...valid, png: altered }), /PNG|CRC|checksum|identity|invalid|Invalid/i);
  }
});
