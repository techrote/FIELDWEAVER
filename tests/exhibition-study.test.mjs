import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILTIN_PRESETS } from '../src/presets/index.js';
import { recipeHash } from '../src/recipe/index.js';
import { exhibitionEntries } from '../src/ui/exhibition-catalog.js';
import { renderVisualIndexProof } from '../src/ui/exhibition-visual-index-model.js';
import { studyNextId, studyArtworkLabel, studyPixelCursor, buildStudySelectedWorkBundle, buildStudyPinnedPairBundle } from '../src/ui/exhibition-study.js';
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

test('pinned live A/B ZIP agrees byte-for-byte with all six script-free accepted board pairs', () => {
  const entries = exhibitionEntries();
  const tiles = entries.map(entry => renderVisualIndexProof(entry.id));
  const board = buildOfflineExhibitionBoard(tiles);
  const expectedLinks = [...board.html.matchAll(
    /<a download="([^"]+\.fwabpack\.zip)" href="data:application\/zip;base64,([^"]+)">Save complete A\/B evidence \(ZIP\)<\/a>/g
  )];
  assert.equal(expectedLinks.length, 6);
  const expected = new Map(expectedLinks.map(([, filename, base64]) =>
    [filename, Buffer.from(base64, 'base64')]));
  const recipeHashes = BUILTIN_PRESETS.map(preset => recipeHash(preset.recipe));
  for (let a = 0; a < tiles.length; a += 1) {
    for (let b = a + 1; b < tiles.length; b += 1) {
      const pack = buildStudyPinnedPairBundle(tiles[a], tiles[b]);
      assert.deepEqual(Buffer.from(pack.bytes), expected.get(pack.filename),
        'The live and offline board must transport the same A/B originals and exact ledger');
      assert.deepEqual(buildStudyPinnedPairBundle(tiles[a], tiles[b]).bytes, pack.bytes);
      assert.throws(() => buildStudyPinnedPairBundle(tiles[a], {
        ...tiles[b], rawRgbaHash: '0000000000000000'
      }), /canonical PNG|mismatched accepted proof/);
      assert.throws(() => buildStudyPinnedPairBundle({
        ...tiles[a], provenanceJson: JSON.stringify({
          ...JSON.parse(tiles[a].provenanceJson), targetTick: tiles[a].targetTick + 1
        })
      }, tiles[b]), /mismatched canonical provenance/);
    }
  }
  assert.deepEqual(BUILTIN_PRESETS.map(preset => recipeHash(preset.recipe)), recipeHashes);
});

test('reverse pinned A/B is intentionally directional, refuses duplicate or unadmitted works', () => {
  const [a, b] = exhibitionEntries().slice(0, 2).map(entry => renderVisualIndexProof(entry.id));
  assert.throws(() => buildStudyPinnedPairBundle(a, a), /different B/);
  assert.throws(() => buildStudyPinnedPairBundle({
    ...a, id: 'unadmitted-original-art'
  }, b), /accepted canonical source/);
  const forward = buildStudyPinnedPairBundle(a, b);
  const reverse = buildStudyPinnedPairBundle(b, a);
  assert.notEqual(forward.filename, reverse.filename);
  assert.equal(forward.changedPixels, reverse.changedPixels);
  function files(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const files = new Map();
    let p = 0;
    while (p + 30 < bytes.byteLength && view.getUint32(p, true) === 0x04034b50) {
      assert.equal(view.getUint16(p + 8, true), 0);
      const size = view.getUint32(p + 18, true);
      const nameSize = view.getUint16(p + 26, true);
      const extraSize = view.getUint16(p + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nameSize));
      const begin = p + 30 + nameSize + extraSize;
      files.set(name, bytes.subarray(begin, begin + size));
      p = begin + size;
    }
    assert.equal(files.size, 8);
    return files;
  }
  const f = files(forward.bytes), g = files(reverse.bytes);
  const fCompare = JSON.parse(new TextDecoder().decode([...f].find(([name]) => name.endsWith('.fwcompare.json'))[1]));
  const gCompare = JSON.parse(new TextDecoder().decode([...g].find(([name]) => name.endsWith('.fwcompare.json'))[1]));
  assert.equal(fCompare.a.id, a.id);
  assert.equal(fCompare.b.id, b.id);
  assert.equal(gCompare.a.id, b.id);
  assert.equal(gCompare.b.id, a.id);
  assert.equal(gCompare.overlap.differentPixels, fCompare.overlap.differentPixels);
  const rows = pack => new TextDecoder().decode([...pack].find(([name]) => name.endsWith('.fwpixels.csv'))[1])
    .trim().split('\n').slice(1).map(line => line.split(',').map(Number));
  const forwardRows = rows(f), reverseRows = rows(g);
  assert.equal(forwardRows.length, forward.changedPixels);
  assert.equal(reverseRows.length, reverse.changedPixels);
  for (let i = 0; i < forwardRows.length; i += 1) {
    assert.deepEqual(forwardRows[i].slice(0, 2), reverseRows[i].slice(0, 2));
    assert.deepEqual(forwardRows[i].slice(2, 6), reverseRows[i].slice(6, 10));
    assert.deepEqual(forwardRows[i].slice(6, 10), reverseRows[i].slice(2, 6));
    assert.deepEqual(forwardRows[i].slice(10), reverseRows[i].slice(10).map(v => -v));
  }
});
