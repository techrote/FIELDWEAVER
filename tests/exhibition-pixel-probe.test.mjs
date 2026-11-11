import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILTIN_PRESETS } from '../src/presets/index.js';
import { recipeHash } from '../src/recipe/index.js';
import { renderVisualIndexProof } from '../src/ui/exhibition-visual-index-model.js';
import { verifyStudyPng, sampleStudyPixel, studyImageClickPixel, nextVisibleStudyPixel } from '../src/ui/exhibition-pixel-probe.js';

test('inspection samples real verified CPU PNG bytes without changing accepted recipes', () => {
  const before = BUILTIN_PRESETS.map(p => recipeHash(p.recipe));
  for (const preset of BUILTIN_PRESETS) {
    const proof = renderVisualIndexProof(preset.id);
    const pixels = verifyStudyPng(proof.png, proof.widthPx, proof.heightPx, proof.rawRgbaHash);
    assert.equal(pixels.width, 96); assert.equal(pixels.height, 64);
    const first = sampleStudyPixel(pixels, 0, 0);
    assert.deepEqual(first.rgba, Array.from(pixels.rgba.slice(0, 4)));
    assert.match(first.hex, /^#[0-9a-f]{6}$/);
    assert.equal(sampleStudyPixel(pixels, 95, 63).rgba[3], 255);
    for (const [x,y] of [[-1,0], [96,0], [0,64], [1.5,2]]) {
      assert.throws(() => sampleStudyPixel(pixels,x,y), /outside/);
    }
    assert.throws(() => sampleStudyPixel({ ...pixels, rgba: new Uint8Array(4) }, 0, 0), /outside/);
  }
  assert.deepEqual(BUILTIN_PRESETS.map(p => recipeHash(p.recipe)), before);
});

test('inspection rejects altered archives and forged pixel identities', () => {
  const proof = renderVisualIndexProof('first-weave');
  assert.throws(() => verifyStudyPng(proof.png, 100, 64, proof.rawRgbaHash), /mismatch/);
  assert.throws(() => verifyStudyPng(proof.png, 96, 64, '0000000000000000'), /mismatch/);
  const damaged = proof.png.slice();
  damaged[damaged.length-8] ^= 1;
  assert.throws(() => verifyStudyPng(damaged, 96, 64, proof.rawRgbaHash), /CRC|PNG/);
});

test('pointer mapping accounts for object-fit contain letterbox and boundaries', () => {
  const rect = {left: 10, top: 20, width: 200, height: 200};
  assert.deepEqual(studyImageClickPixel(rect,100,50,11,71), {x:0,y:0});
  assert.deepEqual(studyImageClickPixel(rect,100,50,209,169), {x:99,y:49});
  assert.equal(studyImageClickPixel(rect,100,50,100,50), null);
  assert.equal(studyImageClickPixel(rect,100,50,100,170), null);
  assert.equal(studyImageClickPixel({...rect, height:0},100,50,100,100), null);
});


test('find next visible mark uses actual canonical decoded pixel bytes, wraps and rejects empty crops', () => {
  for (const preset of BUILTIN_PRESETS) {
    const proof = renderVisualIndexProof(preset.id);
    const pixels = verifyStudyPng(proof.png, proof.widthPx, proof.heightPx, proof.rawRgbaHash);
    const mark = nextVisibleStudyPixel(pixels, 48, 32);
    assert.ok(mark, preset.name + ' must contain visible deposition');
    const sample = sampleStudyPixel(pixels, mark.x, mark.y);
    assert.notDeepEqual(sample.rgba, [9, 11, 8, 255]);
    const after = nextVisibleStudyPixel(pixels, mark.x, mark.y);
    assert.ok(after);
  }
  assert.equal(nextVisibleStudyPixel({ width: 1, height: 1, rgba: Uint8Array.of(9,11,8,255) }, 0, 0), null);
  assert.deepEqual(nextVisibleStudyPixel({ width: 1, height: 1, rgba: Uint8Array.of(240,20,30,255) }, 0, 0), {x:0,y:0});
  assert.throws(() => nextVisibleStudyPixel({ width: 1, height: 1, rgba: Uint8Array.of(9,11,8,255) }, 1, 0), /outside/);
});
