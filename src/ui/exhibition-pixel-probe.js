import { decodePngRgba, rawRgbaHash } from '../export/index.js';

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
