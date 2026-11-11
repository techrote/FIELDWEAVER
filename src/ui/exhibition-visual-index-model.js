import { decodePngRgba, rawRgbaHash } from '../export/index.js';
import { compareExhibitionProofs, exhibitionEntries, renderExhibitionProof } from './exhibition-catalog.js';

// Only true FW-012 CPU frames may become thumbnails. Check the exported PNG,
// decoded pixels, receipt and immutable accepted recipe before publishing.
export function verifyVisualIndexProof(id, proof) {
  const entry = exhibitionEntries().find((item) => item.id === id);
  if (!entry) throw new RangeError('Unknown accepted exhibition work: ' + id);
  const comparison = compareExhibitionProofs(proof, proof);
  if (comparison.leftId !== id || proof.recipeHash !== entry.recipeHash ||
      proof.targetTick !== entry.targetTick) {
    throw new Error('Visual index identity does not match accepted entry.');
  }
  const decoded = decodePngRgba(proof.png);
  if (decoded.widthPx !== entry.exportCrop.widthPx ||
      decoded.heightPx !== entry.exportCrop.heightPx ||
      decoded.rgba.length !== proof.rgba.length) {
    throw new Error('Visual index PNG dimensions do not match accepted crop.');
  }
  for (let i = 0; i < decoded.rgba.length; i += 1) {
    if (decoded.rgba[i] !== proof.rgba[i]) throw new Error('Visual index PNG differs from canonical pixels.');
  }
  if (rawRgbaHash(decoded.rgba) !== proof.rawRgbaHash) {
    throw new Error('Visual index decoded RGBA8 identity mismatch.');
  }
  const receipt = JSON.parse(proof.provenanceJson);
  if (receipt.rawRgbaHash !== proof.rawRgbaHash ||
      receipt.recipeHash !== entry.recipeHash ||
      receipt.targetTick !== entry.targetTick ||
      receipt.seed !== entry.seed) {
    throw new Error('Visual index provenance does not match accepted work.');
  }
  return Object.freeze({
    id, name: entry.name, seed: entry.seed,
    targetTick: entry.targetTick, recipeHash: entry.recipeHash,
    rawRgbaHash: proof.rawRgbaHash, widthPx: decoded.widthPx,
    heightPx: decoded.heightPx, png: proof.png
  });
}

export function renderVisualIndexProof(id) {
  return verifyVisualIndexProof(id, renderExhibitionProof(id));
}
