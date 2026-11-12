import { decodePngRgba, rawRgbaHash, DEFAULT_EXPORT_BACKGROUND_RGBA8 } from '../export/index.js';

// Decode only actual FW-012 CPU PNG bytes; independently bind the stored
// decoded-image oracle before exposing pixels to a gallery inspector.
export function verifyStudyPng(png, width, height, hash) {
  if (!(png instanceof Uint8Array) || !Number.isInteger(width) ||
      !Number.isInteger(height) || width < 1 || height < 1 ||
      !/^[0-9a-f]{16}$/.test(hash)) throw new TypeError('Verified CPU crop and hash are required.');
  const data = decodePngRgba(png);
  if (data.widthPx !== width || data.heightPx !== height || rawRgbaHash(data.rgba) !== hash) {
    throw new Error('Canonical PNG crop or decoded RGBA8 identity mismatch.');
  }
  return Object.freeze({ width, height, hash, rgba: data.rgba });
}

export function sampleStudyPixel(pixels, x, y) {
  if (!(pixels?.rgba instanceof Uint8Array) ||
      !Number.isInteger(pixels.width) || !Number.isInteger(pixels.height) ||
      pixels.rgba.length !== pixels.width * pixels.height * 4 ||
      !Number.isInteger(x) || !Number.isInteger(y) ||
      x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) {
    throw new RangeError('Pixel coordinates outside decoded image.');
  }
  const offset = (y * pixels.width + x) * 4;
  const rgba = Array.from(pixels.rgba.subarray(offset, offset + 4));
  return Object.freeze({ x, y, rgba: Object.freeze(rgba),
    hex: '#' + rgba.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('') });
}

// Actual CSS image content-box sampling, including object-fit:contain margins.
export function studyImageClickPixel(rect, width, height, clientX, clientY) {
  if (![rect?.left, rect?.top, rect?.width, rect?.height, clientX, clientY].every(Number.isFinite) ||
      rect.width <= 0 || rect.height <= 0 ||
      !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  const scale = Math.min(rect.width / width, rect.height / height);
  const left = rect.left + (rect.width - width * scale) / 2;
  const top = rect.top + (rect.height - height * scale) / 2;
  const x = Math.floor((clientX - left) / scale), y = Math.floor((clientY - top) / scale);
  return (x >= 0 && y >= 0 && x < width && y < height) ? Object.freeze({ x, y }) : null;
}


// Scan the authoritative decoded raster, not the enlarged CSS image. The
// versioned FW-012 background is the only exclusion; hidden marks are not
// inferred from a WebGL preview or presentation colour transform.
export function nextVisibleStudyPixel(pixels, x, y) {
  sampleStudyPixel(pixels, x, y);
  const count = pixels.width * pixels.height;
  const start = y * pixels.width + x;
  for (let delta = 1; delta <= count; delta += 1) {
    const index = (start + delta) % count, offset = index * 4;
    if (DEFAULT_EXPORT_BACKGROUND_RGBA8.some((value, channel) => pixels.rgba[offset + channel] !== value)) {
      return Object.freeze({ x: index % pixels.width, y: Math.floor(index / pixels.width) });
    }
  }
  return null; // Entire canonical crop is blank.
}


// Numeric A/B comparison of the same *image-local* coordinate from two
// independently verified decoded CPU rasters. Callers must label different
// authored crops explicitly; this function does not infer world alignment.
export function compareStudyPixelChannels(aPixels, bPixels, x, y) {
  const a = sampleStudyPixel(aPixels, x, y);
  const b = sampleStudyPixel(bPixels, x, y);
  const delta = Object.freeze(a.rgba.map((value, channel) => b.rgba[channel] - value));
  return Object.freeze({ x, y, a, b, delta,
    identical: delta.every((difference) => difference === 0) });
}

// Advance in row-major order through the shared image-local intersection of
// two independently verified CPU rasters. The source pixel under the cursor
// is visited last on wraparound, so a sole difference is still discoverable.
// No crop alignment, resampling, RGB compositing or WebGL data is inferred.
export function nextDifferingStudyPixel(aPixels, bPixels, x, y) {
  sampleStudyPixel(aPixels, x, y);
  sampleStudyPixel(bPixels, x, y);
  const width = Math.min(aPixels.width, bPixels.width);
  const height = Math.min(aPixels.height, bPixels.height);
  const count = width * height, start = y * width + x;
  for (let advance = 1; advance <= count; advance += 1) {
    const index = (start + advance) % count;
    const col = index % width, row = Math.floor(index / width);
    const aOffset = (row * aPixels.width + col) * 4;
    const bOffset = (row * bPixels.width + col) * 4;
    if ([0, 1, 2, 3].some(channel =>
      aPixels.rgba[aOffset + channel] !== bPixels.rgba[bOffset + channel])) {
      return Object.freeze({ x: col, y: row });
    }
  }
  return null;
}

export function sameStudyCrop(a, b) {
  return a?.widthPx === b?.widthPx && a?.heightPx === b?.heightPx &&
    a?.unitsPerPixelQ16 === b?.unitsPerPixelQ16 &&
    a?.center?.chunkX === b?.center?.chunkX &&
    a?.center?.chunkY === b?.center?.chunkY &&
    a?.center?.localX === b?.center?.localX &&
    a?.center?.localY === b?.center?.localY;
}

export const STUDY_PIXEL_RECEIPT_VERSION = 'fw-exhibition-pixel-receipt-v1';

// A portable, deterministic record of one or two independently verified CPU
// source pixels. The caller must renew the live source leases and decode the
// in-memory PNGs before calling. The same image-local coordinate is intentional;
// only exactly identical authored crops identify the same world pixel centre.
function receiptPixelSource(source, x, y) {
  const { entry, pixels, hash } = source ?? {};
  if (!entry || !pixels || !/^[0-9a-f]{16}$/.test(hash ?? '') ||
      pixels.hash !== hash ||
      entry.exportCrop?.widthPx !== pixels.width ||
      entry.exportCrop?.heightPx !== pixels.height ||
      !/^[0-9a-f]{16}$/.test(entry.recipeHash ?? '') ||
      !Number.isInteger(entry.targetTick) || !Number.isInteger(entry.seed)) {
    throw new Error('Pixel receipt requires a current accepted decoded CPU source.');
  }
  return Object.freeze({
    id: entry.id, name: entry.name, recipeHash: entry.recipeHash,
    seed: entry.seed, targetTick: entry.targetTick,
    crop: entry.exportCrop, rawRgbaHash: hash,
    pixel: sampleStudyPixel(pixels, x, y)
  });
}

export function buildStudyPixelReceipt(aSource, bSource, x, y, inspectedId) {
  const a = receiptPixelSource(aSource, x, y);
  const b = bSource == null ? null : receiptPixelSource(bSource, x, y);
  if (inspectedId !== a.id && inspectedId !== b?.id) {
    throw new Error('Pixel receipt inspected image is not a current source.');
  }
  const sameCrop = b ? sameStudyCrop(a.crop, b.crop) : null;
  const delta = b ? Object.freeze(a.pixel.rgba.map((v, i) => b.pixel.rgba[i] - v)) : null;
  return Object.freeze({
    version: STUDY_PIXEL_RECEIPT_VERSION,
    coordinateSpace: 'image-local-top-left',
    coordinate: Object.freeze({ x, y }),
    inspectedId, a, b,
    comparison: b ? Object.freeze({
      deltaBMinusA: delta,
      identical: delta.every(v => v === 0),
      sameAuthoredCrop: sameCrop,
      alignment: sameCrop ? 'same-authored-crop' : 'image-local-only-not-world-aligned'
    }) : null
  });
}
