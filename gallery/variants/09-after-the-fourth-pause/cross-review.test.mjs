import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { decodePngRgba, rawRgbaHash } from '../../../src/export/index.js';

const root = dirname(fileURLToPath(import.meta.url));
const expected = [
  {
    "id": "v09",
    "blob": "bd4533eae5af5fa379295f8b1a1fdd1da9819eef",
    "rgba": "753ce0ca6b5e2aea",
    "width": 256,
    "height": 192
  },
  {
    "id": "v08",
    "blob": "2332216882e8ea41f8ee4f3d5b7b80da06a143d1",
    "rgba": "62d1908684a579ba",
    "width": 224,
    "height": 168
  },
  {
    "id": "v06",
    "blob": "d2d77692fe0ad38d598c999e4580bf0290287a4e",
    "rgba": "80a5a090d57b6d07",
    "width": 192,
    "height": 144
  },
  {
    "id": "v05",
    "blob": "9d702aaa9b3daadeb922880fd11dbd581b6f7a14",
    "rgba": "c5a30c3fbf9025a4",
    "width": 192,
    "height": 144
  },
  {
    "id": "v01",
    "blob": "17eff28c0e8490ef62f1b9ea6c1fb3b7840d4758",
    "rgba": "fcbe4656aac5c30b",
    "width": 144,
    "height": 112
  }
];

test('variant 09: offline cross-PR review embeds exact archived canonical PNGs', async () => {
  const html = await readFile(join(root, 'cross-variant-review.html'), 'utf8');
  assert(html.length < 950000, 'review artifact must remain bounded');
  assert(!/<script\b|<iframe\b|<link\b/i.test(html), 'no executable or external content');
  const matches = [...html.matchAll(/<img data-art="(v\d+)" src="data:image\/png;base64,([A-Za-z0-9+/=]+)"/g)];
  assert.equal(matches.length, expected.length, 'five genuine canonical image panels');
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i], [_, id, b64] = matches[i];
    assert.equal(id, e.id);
    const bytes = Buffer.from(b64, 'base64');
    const blob = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    assert.equal(blob, e.blob, 'pinned source Git blob: ' + id);
    const decoded = decodePngRgba(bytes);
    assert.equal(decoded.widthPx, e.width);
    assert.equal(decoded.heightPx, e.height);
    assert.equal(rawRgbaHash(decoded.rgba), e.rgba, 'decoded canonical RGBA8: ' + id);
    if (id === 'v09') assert.deepEqual(bytes, await readFile(join(root, 'selected.png')));
  }
  assert(!/<img[^>]*src="https?:/i.test(html), 'no external image requests');
});
