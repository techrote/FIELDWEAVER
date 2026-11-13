import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILTIN_PRESETS } from '../src/presets/index.js';
import { recipeHash } from '../src/recipe/index.js';
import { exhibitionEntries } from '../src/ui/exhibition-catalog.js';
import { renderVisualIndexProof } from '../src/ui/exhibition-visual-index-model.js';
import { studyNextId, studyArtworkLabel, studyPixelCursor, buildStudySelectedWorkBundle } from '../src/ui/exhibition-study.js';
import { verifyOfflineExhibitionTile, buildOfflineExhibitionBoard } from '../src/ui/exhibition-offline-board.js';

test('canonical study cycles the accepted catalog in both directions without introducing other works', () => {
  const ids = exhibitionEntries().map((entry) => entry.id);
  assert.equal(ids.length, 4);
  assert.equal(studyNextId(ids, ids[0], -1), ids[3]);
  assert.equal(studyNextId(ids, ids[3], 1), ids[0]);
  assert.equal(studyNextId(ids, ids[1], 6), ids[3]);
  assert.throws(() => studyNextId(ids, 'unmerged-artwork', 1), /Unknown accepted/);
  assert.throws(() => studyNextId(ids, ids[0], 1.5), /Invalid accepted/);
  assert.throws(() => studyNextId([ids[0], ids[0]], ids[0], 1), /Invalid accepted/);
});

test('study shows identities of truly generated canonical CPU images without recipe mutation', () => {
  const before = BUILTIN_PRESETS.map((preset) => recipeHash(preset.recipe));
  for (const entry of exhibitionEntries()) {
    const proof = renderVisualIndexProof(entry.id);
    const label = studyArtworkLabel(entry, proof.rawRgbaHash);
    assert.equal(label.id, entry.id);
    assert.match(label.alt, /Canonical CPU software-raster/);
    assert(label.details.includes('Seed ' + entry.seed));
    assert(label.details.includes('tick ' + entry.targetTick));
    assert(label.details.includes('recipe ' + entry.recipeHash));
    assert(label.details.includes('decoded RGBA8 ' + proof.rawRgbaHash));
    assert(label.details.includes('crop ' + entry.exportCrop.widthPx + '×' + entry.exportCrop.heightPx));
    assert.equal(Object.isFrozen(label), true);
    assert.throws(() => studyArtworkLabel(entry, 'proxy-image'), /verified accepted CPU/);
  }
  assert.deepEqual(BUILTIN_PRESETS.map((preset) => recipeHash(preset.recipe)), before);
});


test('keyboard pixel cursor moves in canonical source coordinates and clamps at crop boundaries', () => {
  assert.deepEqual(studyPixelCursor(96, 64, 48, 32, 'ArrowRight'), { x: 49, y: 32 });
  assert.deepEqual(studyPixelCursor(96, 64, 49, 32, 'ArrowDown', true), { x: 49, y: 42 });
  assert.deepEqual(studyPixelCursor(96, 64, 0, 0, 'ArrowLeft', true), { x: 0, y: 0 });
  assert.deepEqual(studyPixelCursor(96, 64, 95, 63, 'ArrowDown', true), { x: 95, y: 63 });
  assert.deepEqual(studyPixelCursor(1, 1, 0, 0, 'ArrowRight'), { x: 0, y: 0 });
  assert.equal(studyPixelCursor(96, 64, 48, 32, 'Enter'), null);
  assert.equal(Object.isFrozen(studyPixelCursor(96, 64, 1, 1, 'ArrowUp')), true);
  for (const args of [[0, 64, 0, 0, 'ArrowUp'], [96, 64, -1, 0, 'ArrowUp'],
    [96, 64, 96, 0, 'ArrowUp'], [96, 64, 1.2, 0, 'ArrowUp'],
    [96, 64, 0, 0, 'ArrowUp', 'yes']]) {
    assert.throws(() => studyPixelCursor(...args), /Invalid canonical pixel cursor geometry/);
  }
});

test('selected study provenance is a full verified CPU receipt, not an unframed recipe or stale pixels', () => {
  const before = BUILTIN_PRESETS.map((preset) => recipeHash(preset.recipe));
  for (const entry of exhibitionEntries()) {
    const tile = renderVisualIndexProof(entry.id);
    const receipt = verifyOfflineExhibitionTile(entry, tile);
    assert.equal(receipt.rawRgbaHash, tile.rawRgbaHash);
    assert.equal(receipt.targetTick, entry.targetTick);
    assert.deepEqual(receipt.crop, entry.exportCrop);
    assert.equal(recipeHash(receipt.recipe), entry.recipeHash);
    const badReceipt = { ...receipt, targetTick: receipt.targetTick + 1 };
    assert.throws(() => verifyOfflineExhibitionTile(entry, {
      ...tile, provenanceJson: JSON.stringify(badReceipt)
    }), /mismatched canonical provenance/);
    const alteredPng = tile.png.slice();
    alteredPng[alteredPng.length - 8] ^= 1;
    assert.throws(() => verifyOfflineExhibitionTile(entry, {
      ...tile, png: alteredPng
    }), /CRC|PNG|canonical/);
    assert.throws(() => verifyOfflineExhibitionTile(entry, {
      ...tile, rawRgbaHash: '0000000000000000'
    }), /canonical PNG|mismatched accepted proof/);
  }
  assert.deepEqual(BUILTIN_PRESETS.map((preset) => recipeHash(preset.recipe)), before);
});

test('live selected-work bundle uses exactly the accepted offline three-file ZIP', () => {
  const entries = exhibitionEntries();
  const tiles = entries.map((entry) => renderVisualIndexProof(entry.id));
  const board = buildOfflineExhibitionBoard(tiles);
  const links = [...board.html.matchAll(/<a download="([^"]+\.fwpack\.zip)" href="data:application\/zip;base64,([^"]+)">Save complete work bundle \(ZIP\)<\/a>/g)];
  assert.equal(links.length, entries.length);
  const expected = new Map(links.map(([, name, base64]) =>
    [name, Buffer.from(base64, 'base64')]));
  const unchangedHashes = BUILTIN_PRESETS.map((preset) => recipeHash(preset.recipe));
  for (const [index, entry] of entries.entries()) {
    const tile = tiles[index];
    const bundle = buildStudySelectedWorkBundle(entry, tile);
    assert.equal(bundle.filename, 'fieldweaver-' + entry.id + '-' + tile.rawRgbaHash + '.fwpack.zip');
    assert(bundle.bytes instanceof Uint8Array);
    assert.deepEqual(Buffer.from(bundle.bytes), expected.get(bundle.filename),
      'ZIP must exactly preserve canonical PNG, importable recipe and FW-012 provenance');
    assert.deepEqual(buildStudySelectedWorkBundle(entry, tile).bytes, bundle.bytes);
    assert.throws(() => buildStudySelectedWorkBundle(entry, {
      ...tile, rawRgbaHash: '0000000000000000'
    }), /canonical PNG|mismatched accepted proof/);
    assert.throws(() => buildStudySelectedWorkBundle(entry, {
      ...tile, provenanceJson: JSON.stringify({
        ...JSON.parse(tile.provenanceJson), targetTick: tile.targetTick + 1
      })
    }), /mismatched canonical provenance/);
  }
  assert.deepEqual(BUILTIN_PRESETS.map((preset) => recipeHash(preset.recipe)), unchangedHashes);
});
