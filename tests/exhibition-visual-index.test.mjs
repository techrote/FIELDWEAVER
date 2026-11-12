import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { decodePngRgba, rawRgbaHash } from '../src/export/index.js';

import { parseRecipe, recipeHash, serializeRecipe } from '../src/recipe/index.js';
import { BUILTIN_PRESETS } from '../src/presets/index.js';
import { exhibitionEntries, renderExhibitionProof } from '../src/ui/exhibition-catalog.js';
import { renderVisualIndexProof, verifyVisualIndexProof } from '../src/ui/exhibition-visual-index-model.js';
import { buildOfflineExhibitionBoard } from '../src/ui/exhibition-offline-board.js';
import { createStoredZip } from '../src/ui/exhibition-work-bundle.js';

// Independent table-driven CRC oracle (the writer uses per-bit long division).
// The published ZIP CRC-32 check vector "123456789" must equal 0xcbf43926.
function referenceZipCrc32(bytes) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  let value = 0xffffffff;
  for (const byte of bytes) value = table[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

// Independent reader of ZIP central/local directory entries. Do not use the
// writer as the test oracle for a portable package's actual payload.
function readStoredZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at) => view.getUint16(at, true), u32 = (at) => view.getUint32(at, true);
  const end = bytes.length - 22;
  assert.equal(u32(end), 0x06054b50, 'ZIP end-of-central-directory signature');
  assert.equal(u16(end + 4), 0, 'single disk');
  assert.equal(u16(end + 6), 0, 'single central directory disk');
  assert.equal(u16(end + 20), 0, 'no trailing ZIP comment');
  const count = u16(end + 10);
  assert.equal(u16(end + 8), count);
  const centralSize = u32(end + 12);
  let pos = u32(end + 16);
  assert.equal(pos + centralSize, end, 'central directory must exactly precede EOCD');
  const files = new Map();
  for (let n = 0; n < count; n += 1) {
    assert.equal(u32(pos), 0x02014b50, 'central directory entry signature');
    assert.equal(u16(pos + 10), 0, 'lossless STORE method');
    assert.equal(u16(pos + 12), 0, 'deterministic central DOS time');
    assert.equal(u16(pos + 14), 0x0021, 'earliest valid ZIP DOS date (1980-01-01)');
    const size = u32(pos + 24);
    assert.equal(u32(pos + 20), size, 'no compressed payload transformation');
    const nameSize = u16(pos + 28);
    const name = Buffer.from(bytes.subarray(pos + 46, pos + 46 + nameSize)).toString('ascii');
    const local = u32(pos + 42);
    assert.equal(u32(local), 0x04034b50, 'local header signature');
    assert.equal(u16(local + 8), 0);
    assert.equal(u16(local + 10), 0, 'deterministic local DOS time');
    assert.equal(u16(local + 12), 0x0021, 'valid local DOS date matches central');
    const localNameSize = u16(local + 26);
    assert.equal(localNameSize, nameSize);
    assert.equal(Buffer.from(bytes.subarray(local + 30, local + 30 + nameSize)).toString('ascii'), name);
    const dataStart = local + 30 + localNameSize + u16(local + 28);
    const data = bytes.slice(dataStart, dataStart + size);
    assert.equal(data.length, size);
    assert.equal(u32(local + 14), u32(pos + 16), 'local and central CRC must agree');
    assert.equal(u32(pos + 16), referenceZipCrc32(data),
      'independent ZIP CRC32 must protect the actual extracted source bytes');
    assert(!files.has(name), 'ZIP names must be unique');
    files.set(name, data);
    pos += 46 + nameSize + u16(pos + 30) + u16(pos + 32);
  }
  assert.equal(pos, end);
  return files;
}

test('visual index decodes all accepted CPU proofs at golden tick/crop without editing recipes', async () => {
  const fixtures = JSON.parse(await readFile(new URL('../fixtures/fw-014-presets.json', import.meta.url), 'utf8'));
  const before = BUILTIN_PRESETS.map((preset) => recipeHash(preset.recipe));
  const entries = exhibitionEntries();
  assert.equal(entries.length, 4);
  for (const entry of entries) {
    const tile = renderVisualIndexProof(entry.id);
    assert.equal(tile.name, entry.name);
    assert.equal(tile.seed, entry.seed);
    assert.equal(tile.recipeHash, entry.recipeHash);
    assert.equal(tile.targetTick, entry.targetTick);
    assert.equal(tile.widthPx, entry.exportCrop.widthPx);
    assert.equal(tile.heightPx, entry.exportCrop.heightPx);
    assert.equal(tile.rawRgbaHash, fixtures.presets[entry.id].rawRgbaHash);
    assert.ok(tile.png.length > 256, 'real PNG bytes are required');
    assert(Object.isFrozen(tile));
  }
  assert.deepEqual(BUILTIN_PRESETS.map((preset) => recipeHash(preset.recipe)), before);
});

test('visual index rejects corrupted canonical images, proxy identities and forged receipts', () => {
  const proof = renderExhibitionProof('first-weave');
  const corrupted = proof.png.slice();
  corrupted[corrupted.length - 8] ^= 1;
  assert.throws(() => verifyVisualIndexProof('first-weave', { ...proof, png: corrupted }), /PNG|CRC|IEND/);
  assert.throws(() => verifyVisualIndexProof('first-weave', { ...proof, exhibitionVersion: 'preview-v1' }), /canonical exhibition proof/);
  assert.throws(() => verifyVisualIndexProof('operator-atlas', proof), /identity does not match accepted entry/);
  assert.throws(() => verifyVisualIndexProof('first-weave', { ...proof, rawRgbaHash: '0000000000000000' }), /Conflicting canonical|decoded RGBA8/);
  const receipt = JSON.parse(proof.provenanceJson);
  receipt.seed += 1;
  assert.throws(() => verifyVisualIndexProof('first-weave', { ...proof, provenanceJson: JSON.stringify(receipt) }), /provenance/);
  assert.throws(() => renderVisualIndexProof('not-a-preset'), /Unknown FIELDWEAVER preset/);
});

test('offline board embeds four real CPU PNGs and complete provenance, with no scripts or remote assets', () => {
  const tiles = exhibitionEntries().map((entry) => renderVisualIndexProof(entry.id));
  const board = buildOfflineExhibitionBoard(tiles);
  assert.equal(board.count, 4);
  assert.match(board.html, /^<!doctype html>/i);
  assert.equal((board.html.match(/<article id="work-/g) ?? []).length, 4);
  assert.equal((board.html.match(/src="data:image\/png;base64,/g) ?? []).length, 4);
  assert.equal((board.html.match(/<pre>/g) ?? []).length, 4);
  assert.doesNotMatch(board.html, /<script\b|(?:src|href)="https?:\/\//i);
  assert.match(board.html, /default-src &#39;none&#39;/);
  assert.match(board.html, /\.work figcaption,footer\{color:#333\}/,
    'Printed captions and footer must retain readable contrast on white paper');
  for (const tile of tiles) {
    assert(board.html.includes(tile.rawRgbaHash));
    assert(board.html.includes(tile.recipeHash));
  }
  const pairRows = [...board.html.matchAll(/<tr data-pair-a="([^"]+)" data-pair-b="([^"]+)" data-differences="(\d+)" data-overlap="(\d+)">/g)];
  assert.equal(pairRows.length, 6, 'four accepted works generate six source-exact pairs');
  // The optional script-free A/B disclosure must use the exact same
  // independently checked PNG source bytes as the four canonical work cards.
  // CSS data: backgrounds avoid adding another raster/export subsystem.
  const previews = [...board.html.matchAll(/<details class="pair-preview" data-pair-a="([^"]+)" data-pair-b="([^"]+)">/g)];
  assert.equal(previews.length, 6, 'one native keyboard disclosure per accepted pair');
  const rasterPreviews = [...board.html.matchAll(/<div class="pair-raster" role="img" data-work-id="([^"]+)" data-canonical-hash="([^"]+)" aria-label="([^"]+)" style="background-image:url\(data:image\/png;base64,([^)]*)\)"><\/div>/g)];
  const expectedIds = exhibitionEntries().flatMap((entry, index, all) =>
    all.slice(index + 1).flatMap((other) => [entry.id, other.id]));
  assert.equal(rasterPreviews.length, 12, 'both originals visibly available per pair');
  assert.deepEqual(rasterPreviews.map((preview) => preview[1]), expectedIds);
  for (const [, id, hash, label, encoded] of rasterPreviews) {
    const original = tiles.find((tile) => tile.id === id);
    assert(original && label.includes(original.name));
    assert.equal(hash, original.rawRgbaHash);
    const actual = new Uint8Array(Buffer.from(encoded, 'base64'));
    assert.deepEqual(actual, original.png, 'pair preview cannot substitute a thumbnail');
    assert.equal(rawRgbaHash(decodePngRgba(actual).rgba), original.rawRgbaHash);
  }
  assert.equal((board.html.match(/<img\b/g) ?? []).length, 4,
    'optional previews cannot create additional visual index images');
  assert.match(board.html, /href="#comparison-index">A\/B comparison index/);
  assert.match(board.html, /id="comparison-scroll"[^>]+tabindex="0"/);
  const decodedById = new Map(tiles.map((tile) => [tile.id, decodePngRgba(tile.png)]));
  const seenPairs = new Set();
  for (const [, aId, bId, countText, totalText] of pairRows) {
    const key = aId + '/' + bId;
    assert(!seenPairs.has(key), 'duplicate pair ' + key);
    seenPairs.add(key);
    const a = decodedById.get(aId), b = decodedById.get(bId);
    assert(a && b, 'only accepted original CPU rasters may be compared');
    const width = Math.min(a.widthPx, b.widthPx);
    const height = Math.min(a.heightPx, b.heightPx);
    let expected = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const aAt = (y * a.widthPx + x) * 4;
        const bAt = (y * b.widthPx + x) * 4;
        if ([0, 1, 2, 3].some((ch) => a.rgba[aAt + ch] !== b.rgba[bAt + ch])) expected += 1;
      }
    }
    assert.equal(Number(countText), expected, 'decoded CPU RGBA8 mismatch for ' + key);
    assert.equal(Number(totalText), width * height);
  }
  // An independent raw-RGBA8 oracle must match every row of each complete
  // CSV, not merely the total, and its native disclosure count.
  const ledgers = [...board.html.matchAll(/<a download="([^"]+\.fwpixels\.csv)" href="data:text\/csv;base64,([^"]+)">Save exact pixel ledger \(CSV\)<\/a>/g)];
  const ledgerDisclosures = [...board.html.matchAll(/<details class="pair-pixels" data-pair-a="([^"]+)" data-pair-b="([^"]+)" data-count="(\d+)">/g)];
  assert.equal(ledgers.length, 6, 'every accepted A/B pair exports exact changed pixels');
  assert.equal(ledgerDisclosures.length, 6, 'native keyboard inspection per accepted pair');
  const ledgerHeader = 'x,y,a_r,a_g,a_b,a_a,b_r,b_g,b_b,b_a,delta_r,delta_g,delta_b,delta_a';
  for (let i = 0; i < pairRows.length; i += 1) {
    const [, aId, bId, changed] = pairRows[i];
    assert.deepEqual(ledgerDisclosures[i].slice(1),
      [aId, bId, changed], 'inline changed-pixel count matches exact source');
    const a = decodedById.get(aId), b = decodedById.get(bId);
    const expected = [ledgerHeader];
    for (let y = 0; y < Math.min(a.heightPx, b.heightPx); y += 1) {
      for (let x = 0; x < Math.min(a.widthPx, b.widthPx); x += 1) {
        const ai = (y * a.widthPx + x) * 4;
        const bi = (y * b.widthPx + x) * 4;
        const left = Array.from(a.rgba.subarray(ai, ai + 4));
        const right = Array.from(b.rgba.subarray(bi, bi + 4));
        if (left.some((v, channel) => v !== right[channel])) {
          expected.push([x, y, ...left, ...right,
            ...right.map((v, channel) => v - left[channel])].join(','));
        }
      }
    }
    const [ , filename, encoded ] = ledgers[i];
    assert.equal(filename, 'fieldweaver-ab-' + aId + '-vs-' + bId + '-' +
      tiles.find(tile => tile.id === aId).rawRgbaHash + '-' +
      tiles.find(tile => tile.id === bId).rawRgbaHash + '.fwpixels.csv');
    const actual = Buffer.from(encoded, 'base64').toString('utf8');
    assert.equal(actual, expected.join('\n') + '\n',
      'CSV must enumerate all source-exact signed channel differences in row-major order');
    assert.equal(expected.length - 1, Number(changed));
  }
  // Six portable comparison receipts must bind exact verified source identities,
  // bounds and counts; independently scan raw pixels instead of reusing the
  // production overlap helper as the sole oracle.
  const comparisonDownloads = [...board.html.matchAll(/<a download="([^"]+\.fwcompare\.json)" href="data:application\/json;base64,([^"]+)">Save A\/B receipt \(JSON\)<\/a>/g)];
  assert.equal(comparisonDownloads.length, 6);
  for (let i = 0; i < pairRows.length; i += 1) {
    const [, aId, bId, changed, overlap] = pairRows[i];
    const [ , filename, encoded ] = comparisonDownloads[i];
    const receipt = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    const aTile = tiles.find(tile => tile.id === aId);
    const bTile = tiles.find(tile => tile.id === bId);
    const aEntry = exhibitionEntries().find(entry => entry.id === aId);
    const bEntry = exhibitionEntries().find(entry => entry.id === bId);
    assert.equal(receipt.version, 'fw-exhibition-ab-comparison-v1');
    assert.equal(receipt.coordinateSpace, 'image-local-top-left');
    assert.equal(receipt.a.id, aId);
    assert.equal(receipt.b.id, bId);
    assert.equal(receipt.a.recipeHash, aTile.recipeHash);
    assert.equal(receipt.b.recipeHash, bTile.recipeHash);
    assert.equal(receipt.a.rawRgbaHash, aTile.rawRgbaHash);
    assert.equal(receipt.b.rawRgbaHash, bTile.rawRgbaHash);
    assert.equal(receipt.a.seed, aEntry.seed);
    assert.equal(receipt.b.targetTick, bEntry.targetTick);
    assert.deepEqual(receipt.a.crop, aEntry.exportCrop);
    assert.deepEqual(receipt.b.crop, bEntry.exportCrop);
    assert.equal(receipt.overlap.differentPixels, Number(changed));
    assert.equal(receipt.overlap.pixels, Number(overlap));
    assert.deepEqual([receipt.overlap.widthPx, receipt.overlap.heightPx], [96, 64]);
    assert.equal(receipt.alignment,
      JSON.stringify(aEntry.exportCrop) === JSON.stringify(bEntry.exportCrop)
        ? 'same-authored-crop' : 'image-local-only-not-world-aligned');
    assert.equal(filename, 'fieldweaver-ab-' + aId + '-vs-' + bId + '-' +
      aTile.rawRgbaHash + '-' + bTile.rawRgbaHash + '.fwcompare.json');
    const a = decodedById.get(aId), b = decodedById.get(bId);
    const maximum = [0, 0, 0, 0];
    let bounds = null;
    for (let y = 0; y < Math.min(a.heightPx, b.heightPx); y++) {
      for (let x = 0; x < Math.min(a.widthPx, b.widthPx); x++) {
        const ai = (y * a.widthPx + x) * 4;
        const bi = (y * b.widthPx + x) * 4;
        let different = false;
        for (let ch = 0; ch < 4; ch++) {
          const absDelta = Math.abs(a.rgba[ai + ch] - b.rgba[bi + ch]);
          maximum[ch] = Math.max(maximum[ch], absDelta);
          if (absDelta) different = true;
        }
        if (different) {
          bounds ??= { left: x, top: y, right: x, bottom: y };
          bounds.left = Math.min(bounds.left, x);
          bounds.top = Math.min(bounds.top, y);
          bounds.right = Math.max(bounds.right, x);
          bounds.bottom = Math.max(bounds.bottom, y);
        }
      }
    }
    assert.deepEqual(receipt.overlap.boundsInclusive, bounds);
    assert.deepEqual(receipt.overlap.maxAbsDeltaRgba8, maximum);
  }
  // Offline data: downloads are user-initiated, self-contained and importable
  // without script execution or a network request.
  const recipeLinks = [...board.html.matchAll(/<a download="([^"]+\.fwrecipe\.json)" href="data:application\/json;base64,([^"]+)">Save importable recipe<\/a>/g)];
  const receiptLinks = [...board.html.matchAll(/<a download="([^"]+\.fwprovenance\.json)" href="data:application\/json;base64,([^"]+)">Save full provenance<\/a>/g)];
  const pngLinks = [...board.html.matchAll(/<a download="([^"]+\.canonical\.png)" href="data:image\/png;base64,([^"]+)">Save canonical PNG<\/a>/g)];
  assert.equal(recipeLinks.length, 4);
  assert.equal(receiptLinks.length, 4);
  assert.equal(pngLinks.length, 4);
  for (let i = 0; i < 4; i += 1) {
    const tile = tiles[i];
    const recipeText = Buffer.from(recipeLinks[i][2], 'base64').toString('utf8');
    const receiptText = Buffer.from(receiptLinks[i][2], 'base64').toString('utf8');
    assert.equal(recipeLinks[i][1], 'fieldweaver-' + tile.id + '-' + tile.recipeHash + '.fwrecipe.json');
    assert.equal(receiptLinks[i][1], 'fieldweaver-' + tile.id + '-' + tile.rawRgbaHash + '.fwprovenance.json');
    assert.equal(recipeText, serializeRecipe(JSON.parse(tile.provenanceJson).recipe));
    assert.equal(recipeHash(parseRecipe(recipeText)), tile.recipeHash);
    assert.equal(receiptText, tile.provenanceJson);
    assert.equal(pngLinks[i][1], 'fieldweaver-' + tile.id + '-' + tile.rawRgbaHash + '.canonical.png');
    const pngBytes = Buffer.from(pngLinks[i][2], 'base64');
    assert.deepEqual(pngBytes, Buffer.from(tile.png), 'download preserves exact verified CPU PNG bytes');
    assert.equal(rawRgbaHash(decodePngRgba(new Uint8Array(pngBytes)).rgba), tile.rawRgbaHash);
    const images = [...board.html.matchAll(/src="data:image\/png;base64,([^"]+)"/g)];
    assert.equal(pngLinks[i][2], images[i][1], 'displayed and downloadable CPU PNG bytes must match');
  }
  const zipLinks = [...board.html.matchAll(/<a download="([^"]+\.fwpack\.zip)" href="data:application\/zip;base64,([^"]+)">Save complete work bundle \(ZIP\)<\/a>/g)];
  assert.equal(zipLinks.length, 4, 'one offline single-download package per accepted work');
  for (let i = 0; i < zipLinks.length; i += 1) {
    const tile = tiles[i], [ , filename, encoded ] = zipLinks[i];
    assert.equal(filename, 'fieldweaver-' + tile.id + '-' + tile.rawRgbaHash + '.fwpack.zip');
    const files = readStoredZip(new Uint8Array(Buffer.from(encoded, 'base64')));
    assert.equal(files.size, 3, 'only canonical source PNG, recipe and provenance');
    const pngName = 'fieldweaver-' + tile.id + '-' + tile.rawRgbaHash + '.canonical.png';
    const recipeName = 'fieldweaver-' + tile.id + '-' + tile.recipeHash + '.fwrecipe.json';
    const provenanceName = 'fieldweaver-' + tile.id + '-' + tile.rawRgbaHash + '.fwprovenance.json';
    assert.deepEqual(files.get(pngName), tile.png, 'unaltered original canonical PNG bytes');
    assert.equal(Buffer.from(files.get(recipeName)).toString('utf8'),
      serializeRecipe(JSON.parse(tile.provenanceJson).recipe));
    assert.equal(Buffer.from(files.get(provenanceName)).toString('utf8'), tile.provenanceJson);
    assert.equal(rawRgbaHash(decodePngRgba(files.get(pngName)).rgba), tile.rawRgbaHash);
    assert.equal(recipeHash(parseRecipe(Buffer.from(files.get(recipeName)).toString('utf8'))), tile.recipeHash);
  }
  const collectionLinks = [...board.html.matchAll(/<a download="(fieldweaver-accepted-canonical-collection-v1\.zip)" href="data:application\/zip;base64,([^"]+)">Save all accepted works \(ZIP\)<\/a>/g)];
  assert.equal(collectionLinks.length, 1, 'one collection download for the accepted set only');
  const collection = readStoredZip(new Uint8Array(Buffer.from(collectionLinks[0][2], 'base64')));
  assert.equal(collection.size, 12, 'four verified accepted works × three exact files');
  for (let i = 0; i < zipLinks.length; i += 1) {
    const single = readStoredZip(new Uint8Array(Buffer.from(zipLinks[i][2], 'base64')));
    for (const [name, bytes] of single) {
      assert.deepEqual(collection.get(name), bytes,
        'collection member must equal its independently downloadable original: ' + name);
    }
  }
  assert.equal(buildOfflineExhibitionBoard(tiles).html, board.html,
    'collection and board bytes must be deterministic across repeated builds');
  const embedded = /src="data:image\/png;base64,([^"]+)"/.exec(board.html)?.[1];
  assert.deepEqual(Buffer.from(embedded, 'base64'), Buffer.from(tiles[0].png));
});

test('offline board rejects incomplete, duplicate, corrupted and forged canonical evidence', () => {
  const tiles = exhibitionEntries().map((entry) => renderVisualIndexProof(entry.id));
  assert.throws(() => buildOfflineExhibitionBoard(tiles.slice(1)), /all four/);
  assert.throws(() => buildOfflineExhibitionBoard([tiles[0], tiles[0], tiles[2], tiles[3]]), /duplicate/);
  assert.throws(() => buildOfflineExhibitionBoard([{ ...tiles[0], rawRgbaHash: '0000000000000000' }, ...tiles.slice(1)]), /PNG pixels/);
  const corrupt = tiles[0].png.slice();
  corrupt[corrupt.length - 8] ^= 1;
  assert.throws(() => buildOfflineExhibitionBoard([{ ...tiles[0], png: corrupt }, ...tiles.slice(1)]), /PNG|CRC|IEND/);
  const badSeed = JSON.parse(tiles[0].provenanceJson);
  badSeed.recipe.seed ^= 1;
  assert.throws(() => buildOfflineExhibitionBoard([{ ...tiles[0], provenanceJson: JSON.stringify(badSeed) }, ...tiles.slice(1)]), /provenance|recipe/);
  const badCrop = JSON.parse(tiles[0].provenanceJson);
  badCrop.crop.widthPx += 1;
  assert.throws(() => buildOfflineExhibitionBoard([{ ...tiles[0], provenanceJson: JSON.stringify(badCrop) }, ...tiles.slice(1)]), /provenance/);
});

test('ZIP transport refuses path traversal, duplicates and non-byte payloads', () => {
  assert.equal(referenceZipCrc32(Buffer.from('123456789')), 0xcbf43926,
    'published CRC32 check vector guards the independent test oracle');
  const bytes = new Uint8Array([0, 1, 127, 128, 255]);
  assert.deepEqual(createStoredZip([{ name: 'raw.bin', bytes }]),
    createStoredZip([{ name: 'raw.bin', bytes }]), 'work bundles are deterministic');
  assert.deepEqual(readStoredZip(createStoredZip([{ name: 'raw.bin', bytes }])).get('raw.bin'), bytes);
  assert.throws(() => createStoredZip([]), /bounded/);
  assert.throws(() => createStoredZip([{ name: '../escape', bytes }]), /safe filenames/);
  assert.throws(() => createStoredZip([{ name: 'a', bytes }, { name: 'a', bytes }]), /unique safe/);
  assert.throws(() => createStoredZip([{ name: 'a', bytes: 'not binary' }]), /byte arrays/);
});
