// Dependency-free, deterministic ZIP/STORE packaging for accepted offline
// exhibition handoff. This is a transport container, not a new artwork,
// raster, recipe format, or canonical image identity.
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i += 1) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

export function createStoredZip(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 0xffff) {
    throw new RangeError('ZIP requires a bounded set of files.');
  }
  const encoder = new TextEncoder();
  const seen = new Set();
  const entries = files.map(({ name, bytes }) => {
    // Flat, ASCII filenames avoid ambiguous path traversal or ZIP encoding
    // flags. The caller supplies exact canonical source bytes.
    if (typeof name !== 'string' || !/^[a-z0-9._-]+$/.test(name) ||
        name === '.' || name === '..' || seen.has(name) ||
        !(bytes instanceof Uint8Array)) {
      throw new TypeError('ZIP requires unique safe filenames and byte arrays.');
    }
    seen.add(name);
    const filename = encoder.encode(name);
    if (filename.length > 0xffff) throw new RangeError('ZIP filename too long.');
    return { filename, bytes, crc: crc32(bytes), offset: 0 };
  });
  const localSize = entries.reduce((sum, file) => sum + 30 + file.filename.length + file.bytes.length, 0);
  const centralSize = entries.reduce((sum, file) => sum + 46 + file.filename.length, 0);
  const totalSize = localSize + centralSize + 22;
  if (!Number.isSafeInteger(totalSize) || totalSize > 0xffffffff) {
    throw new RangeError('ZIP exceeds non-ZIP64 bounds.');
  }
  const output = new Uint8Array(totalSize);
  const view = new DataView(output.buffer);
  const write16 = (at, n) => view.setUint16(at, n, true);
  const write32 = (at, n) => view.setUint32(at, n, true);
  let at = 0;
  for (const file of entries) {
    file.offset = at;
    write32(at, 0x04034b50);
    write16(at + 4, 20);  // ZIP 2.0 / stored
    write16(at + 6, 0);   // ASCII filename, no descriptor
    write16(at + 8, 0);   // STORE, no lossy recompression
    write16(at + 10, 0); write16(at + 12, 0); // fixed DOS time/date
    write32(at + 14, file.crc);
    write32(at + 18, file.bytes.length);
    write32(at + 22, file.bytes.length);
    write16(at + 26, file.filename.length);
    write16(at + 28, 0);
    at += 30;
    output.set(file.filename, at); at += file.filename.length;
    output.set(file.bytes, at); at += file.bytes.length;
  }
  const centralStart = at;
  for (const file of entries) {
    write32(at, 0x02014b50);
    write16(at + 4, 20); write16(at + 6, 20);
    write16(at + 8, 0); write16(at + 10, 0);
    write16(at + 12, 0); write16(at + 14, 0);
    write32(at + 16, file.crc);
    write32(at + 20, file.bytes.length);
    write32(at + 24, file.bytes.length);
    write16(at + 28, file.filename.length);
    write16(at + 30, 0); write16(at + 32, 0);
    write16(at + 34, 0); write16(at + 36, 0);
    write32(at + 38, 0); write32(at + 42, file.offset);
    at += 46;
    output.set(file.filename, at); at += file.filename.length;
  }
  write32(at, 0x06054b50);
  write16(at + 4, 0); write16(at + 6, 0);
  write16(at + 8, entries.length); write16(at + 10, entries.length);
  write32(at + 12, at - centralStart);
  write32(at + 16, centralStart);
  write16(at + 20, 0);
  at += 22;
  if (at !== output.length) throw new Error('ZIP length invariant failed.');
  return output;
}
