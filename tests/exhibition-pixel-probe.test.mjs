import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILTIN_PRESETS } from '../src/presets/index.js';
import { recipeHash } from '../src/recipe/index.js';
import { renderVisualIndexProof } from '../src/ui/exhibition-visual-index-model.js';
import { exhibitionEntries } from '../src/ui/exhibition-catalog.js';
import { verifyStudyPng, sampleStudyPixel, studyImageClickPixel, nextVisibleStudyPixel, nextDifferingStudyPixel, previousDifferingStudyPixel, compareStudyPixelChannels, sameStudyCrop, buildStudyPixelReceipt, STUDY_PIXEL_RECEIPT_VERSION } from '../src/ui/exhibition-pixel-probe.js';

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


test('A/B source-local delta uses independently decoded canonical PNGs, not a preview', () => {
  const aProof = renderVisualIndexProof('operator-atlas');
  const bProof = renderVisualIndexProof('timeline-pulse');
  const a = verifyStudyPng(aProof.png, aProof.widthPx, aProof.heightPx, aProof.rawRgbaHash);
  const b = verifyStudyPng(bProof.png, bProof.widthPx, bProof.heightPx, bProof.rawRgbaHash);
  for (const [x, y] of [[0, 0], [3, 7], [20, 35], [48, 32], [95, 63]]) {
    const result = compareStudyPixelChannels(a, b, x, y);
    assert.deepEqual(result.a, sampleStudyPixel(a, x, y));
    assert.deepEqual(result.b, sampleStudyPixel(b, x, y));
    assert.deepEqual(result.delta, result.a.rgba.map((value, channel) => result.b.rgba[channel] - value));
    assert.equal(result.identical, result.delta.every((d) => d === 0));
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.delta));
  }
  assert.deepEqual(compareStudyPixelChannels(a, b, 20, 35).delta, [7, 18, 20, 0],
    'accepted fixture has a visible, non-zero exact CPU pixel difference');
  assert.throws(() => compareStudyPixelChannels(a, b, 96, 0), /outside/);
  assert.throws(() => compareStudyPixelChannels(a, { ...b, rgba: new Uint8Array(4) }, 3, 7), /outside/);
  const original = BUILTIN_PRESETS[0].exportCrop;
  assert.equal(sameStudyCrop(original, structuredClone(original)), true);
  const moved = structuredClone(original);
  moved.center.localX += 1;
  assert.equal(sameStudyCrop(original, moved), false);
});

test('next A/B difference scans decoded CPU RGBA8, wraps and never invents world alignment', () => {
  const source = (id) => {
    const proof = renderVisualIndexProof(id);
    return verifyStudyPng(proof.png, proof.widthPx, proof.heightPx, proof.rawRgbaHash);
  };
  const a = source('operator-atlas'), b = source('timeline-pulse');
  const startX = 20, startY = 35;
  const actual = nextDifferingStudyPixel(a, b, startX, startY);
  let expected = null;
  for (let step = 1; step <= a.width * a.height; step += 1) {
    const position = (startY * a.width + startX + step) % (a.width * a.height);
    const offset = position * 4;
    if ([0, 1, 2, 3].some(channel => a.rgba[offset + channel] !== b.rgba[offset + channel])) {
      expected = { x: position % a.width, y: Math.floor(position / a.width) };
      break;
    }
  }
  assert.deepEqual(actual, expected, 'the next difference is independently derived from the accepted CPU rasters');
  let expectedPrevious = null;
  for (let step = 1; step <= a.width * a.height; step += 1) {
    const position = (startY * a.width + startX - step + a.width * a.height) % (a.width * a.height);
    const offset = position * 4;
    if ([0, 1, 2, 3].some(channel => a.rgba[offset + channel] !== b.rgba[offset + channel])) {
      expectedPrevious = { x: position % a.width, y: Math.floor(position / a.width) };
      break;
    }
  }
  assert.deepEqual(previousDifferingStudyPixel(a, b, startX, startY), expectedPrevious,
    'reverse traversal matches an independent decoded-CPU reference oracle');
  assert.deepEqual(previousDifferingStudyPixel(a, b, actual.x, actual.y), { x: startX, y: startY },
    'next and previous round-trip on an actually differing accepted pixel');
  assert.equal(compareStudyPixelChannels(a, b, actual.x, actual.y).identical, false);
  assert.ok(Object.isFrozen(actual));
  assert.equal(nextDifferingStudyPixel(a, a, 20, 35), null);
  assert.equal(previousDifferingStudyPixel(a, a, 20, 35), null);

  const blank = (width, height) => ({ width, height, rgba: new Uint8Array(width * height * 4) });
  const first = blank(3, 2), second = blank(3, 2);
  second.rgba[2 * 4] = 23;
  second.rgba[4 * 4 + 3] = 255; // Alpha-only changes also count.
  assert.deepEqual(nextDifferingStudyPixel(first, second, 0, 0), { x: 2, y: 0 });
  assert.deepEqual(nextDifferingStudyPixel(first, second, 2, 0), { x: 1, y: 1 });
  assert.deepEqual(nextDifferingStudyPixel(first, second, 1, 1), { x: 2, y: 0 });
  assert.deepEqual(previousDifferingStudyPixel(first, second, 2, 0), { x: 1, y: 1 });
  assert.deepEqual(previousDifferingStudyPixel(first, second, 1, 1), { x: 2, y: 0 });
  assert.equal(nextDifferingStudyPixel(first, blank(3, 2), 0, 0), null);
  assert.deepEqual(nextDifferingStudyPixel(blank(1, 1), { width: 1, height: 1, rgba: Uint8Array.of(1, 0, 0, 0) }, 0, 0), { x: 0, y: 0 });

  const wide = blank(4, 2), narrow = blank(2, 1);
  wide.rgba[(0 * 4 + 1) * 4] = 5;
  narrow.rgba[(0 * 2 + 0) * 4] = 3;
  assert.deepEqual(nextDifferingStudyPixel(wide, narrow, 1, 0), { x: 0, y: 0 },
    'different strides use the shared rectangle, without pretending crops align');
  assert.deepEqual(nextDifferingStudyPixel(wide, narrow, 2, 0), { x: 0, y: 0 },
    'a cursor beyond the overlap but within the wide source re-enters at the first difference');
  assert.deepEqual(previousDifferingStudyPixel(wide, narrow, 2, 0), { x: 1, y: 0 },
    'reverse navigation re-enters at the last difference in the shared overlap');
  assert.throws(() => nextDifferingStudyPixel(wide, narrow, 4, 0), /outside/);
  assert.throws(() => previousDifferingStudyPixel(wide, narrow, -1, 0), /outside/);
  assert.throws(() => nextDifferingStudyPixel(a, { ...b, rgba: new Uint8Array(4) }, 0, 0), /outside/);
});

test('portable exact pixel receipt binds accepted CPU identity, tick/crop and deterministic A/B delta', () => {
  const entries = exhibitionEntries();
  const source = (id) => {
    const entry = entries.find(item => item.id === id);
    const proof = renderVisualIndexProof(id);
    return { entry, hash: proof.rawRgbaHash,
      pixels: verifyStudyPng(proof.png, proof.widthPx, proof.heightPx, proof.rawRgbaHash) };
  };
  const a = source('operator-atlas'), b = source('timeline-pulse');
  const receipt = buildStudyPixelReceipt(a, b, 20, 35, 'timeline-pulse');
  assert.equal(receipt.version, STUDY_PIXEL_RECEIPT_VERSION);
  assert.equal(receipt.coordinateSpace, 'image-local-top-left');
  assert.deepEqual(receipt.coordinate, { x: 20, y: 35 });
  assert.equal(receipt.inspectedId, 'timeline-pulse');
  assert.equal(receipt.a.recipeHash, a.entry.recipeHash);
  assert.equal(receipt.b.rawRgbaHash, b.hash);
  assert.equal(receipt.a.targetTick, a.entry.targetTick);
  assert.deepEqual(receipt.b.crop, b.entry.exportCrop);
  assert.deepEqual(receipt.comparison.deltaBMinusA, [7, 18, 20, 0]);
  assert.equal(receipt.comparison.sameAuthoredCrop, sameStudyCrop(a.entry.exportCrop, b.entry.exportCrop));
  assert.deepEqual(JSON.parse(JSON.stringify(receipt)), receipt);
  assert.equal(JSON.stringify(buildStudyPixelReceipt(a, b, 20, 35, 'timeline-pulse')),
    JSON.stringify(receipt), 'the receipt cannot depend on DOM clock or screenshot state');
  assert.equal(buildStudyPixelReceipt(b, null, 3, 7, b.entry.id).comparison, null);
  const shiftedCrop = { ...b.entry, exportCrop: { ...b.entry.exportCrop,
    center: { ...b.entry.exportCrop.center, localX: b.entry.exportCrop.center.localX + 1 } } };
  const shifted = buildStudyPixelReceipt(a, { ...b, entry: shiftedCrop }, 20, 35, 'operator-atlas');
  assert.equal(shifted.comparison.alignment, 'image-local-only-not-world-aligned');
  assert.throws(() => buildStudyPixelReceipt(a, b, 96, 35, 'operator-atlas'), /outside/);
  assert.throws(() => buildStudyPixelReceipt(a, b, 20, 35, 'unadmitted-work'), /not a current source/);
  assert.throws(() => buildStudyPixelReceipt({ ...a, hash: '0000000000000000' }, b, 20, 35, a.entry.id), /current accepted/);
  assert.throws(() => buildStudyPixelReceipt(a, { ...b, pixels: { ...b.pixels, width: 95 } }, 20, 35, a.entry.id), /current accepted/);
});
