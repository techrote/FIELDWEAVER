import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseRecipe, recipeHash, serializeRecipe } from '../src/recipe/index.js';
import { BUILTIN_PRESETS } from '../src/presets/index.js';
import { exhibitionEntries, renderExhibitionProof } from '../src/ui/exhibition-catalog.js';
import { renderVisualIndexProof, verifyVisualIndexProof } from '../src/ui/exhibition-visual-index-model.js';
import { buildOfflineExhibitionBoard } from '../src/ui/exhibition-offline-board.js';

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
  // Offline data: downloads are user-initiated, self-contained and importable
  // without script execution or a network request.
  const recipeLinks = [...board.html.matchAll(/<a download="([^"]+\.fwrecipe\.json)" href="data:application\/json;base64,([^"]+)">Save importable recipe<\/a>/g)];
  const receiptLinks = [...board.html.matchAll(/<a download="([^"]+\.fwprovenance\.json)" href="data:application\/json;base64,([^"]+)">Save full provenance<\/a>/g)];
  assert.equal(recipeLinks.length, 4);
  assert.equal(receiptLinks.length, 4);
  for (let i = 0; i < 4; i += 1) {
    const tile = tiles[i];
    const recipeText = Buffer.from(recipeLinks[i][2], 'base64').toString('utf8');
    const receiptText = Buffer.from(receiptLinks[i][2], 'base64').toString('utf8');
    assert.equal(recipeLinks[i][1], 'fieldweaver-' + tile.id + '-' + tile.recipeHash + '.fwrecipe.json');
    assert.equal(receiptLinks[i][1], 'fieldweaver-' + tile.id + '-' + tile.rawRgbaHash + '.fwprovenance.json');
    assert.equal(recipeText, serializeRecipe(JSON.parse(tile.provenanceJson).recipe));
    assert.equal(recipeHash(parseRecipe(recipeText)), tile.recipeHash);
    assert.equal(receiptText, tile.provenanceJson);
  }
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
