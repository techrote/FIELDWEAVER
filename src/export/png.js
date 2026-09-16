export const PNG_PACKAGE_VERSION = 'fw-png-rgba8-v1';

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const ADLER_MOD = 65521;

function assertDimension(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 100_000) throw new RangeError(`${label} must be an integer in [1, 100000].`);
  return value;
}

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function writeU32BE(target, offset, value) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function readU32BE(bytes, offset) {
  return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % ADLER_MOD;
    b = (b + a) % ADLER_MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function pngChunk(type, data) {
  if (typeof type !== 'string' || type.length !== 4) throw new TypeError('PNG chunk type must be four characters.');
  const typeBytes = new TextEncoder().encode(type);
  const body = concatBytes([typeBytes, data]);
  const chunk = new Uint8Array(12 + data.length);
  writeU32BE(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeU32BE(chunk, 8 + data.length, crc32(body));
  return chunk;
}

function encodeStoredZlib(bytes) {
  const parts = [Uint8Array.of(0x78, 0x01)];
  let offset = 0;
  while (offset < bytes.length || (bytes.length === 0 && offset === 0)) {
    const length = Math.min(65535, bytes.length - offset);
    const final = offset + length >= bytes.length;
    const header = new Uint8Array(5);
    header[0] = final ? 0x01 : 0x00;
    header[1] = length & 0xff;
    header[2] = (length >>> 8) & 0xff;
    const inverse = (~length) & 0xffff;
    header[3] = inverse & 0xff;
    header[4] = (inverse >>> 8) & 0xff;
    parts.push(header);
    if (length > 0) parts.push(bytes.subarray(offset, offset + length));
    offset += length;
    if (final) break;
  }
  const checksum = new Uint8Array(4);
  writeU32BE(checksum, 0, adler32(bytes));
  parts.push(checksum);
  return concatBytes(parts);
}

function decodeStoredZlib(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 6) throw new RangeError('PNG IDAT zlib stream is truncated.');
  const cmf = bytes[0];
  const flg = bytes[1];
  if ((cmf & 0x0f) !== 8 || (((cmf << 8) | flg) % 31) !== 0 || (flg & 0x20) !== 0) {
    throw new RangeError('Unsupported PNG zlib header; expected dependency-free deflate without preset dictionary.');
  }
  const parts = [];
  let total = 0;
  let offset = 2;
  let final = false;
  while (!final) {
    if (offset + 5 > bytes.length - 4) throw new RangeError('PNG stored deflate block is truncated.');
    const blockHeader = bytes[offset];
    final = (blockHeader & 1) !== 0;
    const blockType = (blockHeader >>> 1) & 0x03;
    if (blockType !== 0) throw new RangeError('PNG decoder only accepts canonical stored deflate blocks.');
    offset += 1;
    const length = bytes[offset] | (bytes[offset + 1] << 8);
    const inverse = bytes[offset + 2] | (bytes[offset + 3] << 8);
    offset += 4;
    if (((length ^ inverse) & 0xffff) !== 0xffff) throw new RangeError('PNG stored deflate LEN/NLEN mismatch.');
    if (offset + length > bytes.length - 4) throw new RangeError('PNG stored deflate payload is truncated.');
    parts.push(bytes.subarray(offset, offset + length));
    total += length;
    offset += length;
  }
  if (offset + 4 !== bytes.length) throw new RangeError('PNG zlib stream has unexpected trailing data.');
  const decoded = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    decoded.set(part, cursor);
    cursor += part.length;
  }
  const expectedAdler = readU32BE(bytes, offset);
  if (adler32(decoded) !== expectedAdler) throw new RangeError('PNG zlib Adler-32 mismatch.');
  return decoded;
}

function filteredScanlines(rgba, width, height) {
  const rowBytes = width * 4;
  const scanlines = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const target = y * (rowBytes + 1);
    scanlines[target] = 0;
    scanlines.set(rgba.subarray(y * rowBytes, (y + 1) * rowBytes), target + 1);
  }
  return scanlines;
}

export function encodePngRgba(rgba, widthPx, heightPx) {
  const width = assertDimension(widthPx, 'widthPx');
  const height = assertDimension(heightPx, 'heightPx');
  if (!(rgba instanceof Uint8Array)) throw new TypeError('PNG RGBA input must be Uint8Array.');
  const expected = width * height * 4;
  if (!Number.isSafeInteger(expected) || rgba.length !== expected) {
    throw new RangeError(`PNG RGBA byte length must equal width × height × 4 (${expected}).`);
  }
  const ihdr = new Uint8Array(13);
  writeU32BE(ihdr, 0, width);
  writeU32BE(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = encodeStoredZlib(filteredScanlines(rgba, width, height));
  return concatBytes([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', new Uint8Array(0))
  ]);
}

export function decodePngRgba(pngBytes) {
  if (!(pngBytes instanceof Uint8Array)) throw new TypeError('PNG input must be Uint8Array.');
  if (pngBytes.length < PNG_SIGNATURE.length || !PNG_SIGNATURE.every((byte, index) => pngBytes[index] === byte)) {
    throw new RangeError('Invalid PNG signature.');
  }
  let offset = PNG_SIGNATURE.length;
  let width = null;
  let height = null;
  const idatParts = [];
  let sawIend = false;
  while (offset < pngBytes.length) {
    if (offset + 12 > pngBytes.length) throw new RangeError('PNG chunk header is truncated.');
    const length = readU32BE(pngBytes, offset);
    const typeBytes = pngBytes.subarray(offset + 4, offset + 8);
    const type = new TextDecoder().decode(typeBytes);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > pngBytes.length) throw new RangeError(`PNG ${type} chunk is truncated.`);
    const data = pngBytes.subarray(dataStart, dataEnd);
    const expectedCrc = readU32BE(pngBytes, dataEnd);
    if (crc32(concatBytes([typeBytes, data])) !== expectedCrc) throw new RangeError(`PNG ${type} CRC mismatch.`);
    if (type === 'IHDR') {
      if (length !== 13 || width !== null) throw new RangeError('PNG must contain exactly one valid IHDR first.');
      width = readU32BE(data, 0);
      height = readU32BE(data, 4);
      if (data[8] !== 8 || data[9] !== 6 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new RangeError('PNG must be non-interlaced 8-bit RGBA with standard compression/filter methods.');
      }
    } else if (type === 'IDAT') {
      if (width === null) throw new RangeError('PNG IDAT appeared before IHDR.');
      idatParts.push(data);
    } else if (type === 'IEND') {
      if (length !== 0) throw new RangeError('PNG IEND must be empty.');
      sawIend = true;
      offset = dataEnd + 4;
      break;
    }
    offset = dataEnd + 4;
  }
  if (width === null || height === null || idatParts.length === 0 || !sawIend || offset !== pngBytes.length) {
    throw new RangeError('PNG is missing required IHDR/IDAT/IEND structure or has trailing bytes.');
  }
  const scanlines = decodeStoredZlib(concatBytes(idatParts));
  const rowBytes = width * 4;
  const expectedScanlines = (rowBytes + 1) * height;
  if (scanlines.length !== expectedScanlines) throw new RangeError('PNG decoded scanline length does not match IHDR dimensions.');
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const source = y * (rowBytes + 1);
    if (scanlines[source] !== 0) throw new RangeError('Canonical PNG decoder only accepts filter type 0.');
    rgba.set(scanlines.subarray(source + 1, source + 1 + rowBytes), y * rowBytes);
  }
  return Object.freeze({ version: PNG_PACKAGE_VERSION, widthPx: width, heightPx: height, rgba });
}
