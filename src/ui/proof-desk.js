import { PROOF_DESK_LIMITS, verifyProofPackage } from './proof-desk-verify.js';

const byId = (id) => document.getElementById(id);
const provenanceInput = byId('proof-provenance');
const pngInput = byId('proof-png');
const verifyButton = byId('proof-verify');
const status = byId('proof-status');
const image = byId('proof-image');
const placeholder = byId('proof-placeholder');
const caption = byId('proof-caption');
const details = byId('proof-details');
const pngDownload = byId('proof-download-png');
const receiptDownload = byId('proof-download-provenance');

let generation = 0;
let verifiedProof = null;

function report(text, state = 'ready') {
  status.textContent = text;
  status.value = text;
  status.dataset.state = state;
  document.documentElement.dataset.fieldweaverProofDeskState = state;
}

function clear() {
  generation += 1;
  verifiedProof = null;
  image.hidden = true;
  image.removeAttribute('src');
  image.alt = '';
  placeholder.hidden = false;
  caption.textContent = 'Only verified CPU software-raster pixels will appear here.';
  details.hidden = true;
  document.documentElement.dataset.fieldweaverProofDeskHash = '';
  report('Files selected; choose Verify & reproduce to begin.');
}

function readAsDataUrl(bytes) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error ?? new Error('Unable to show the generated canonical image.'));
    reader.readAsDataURL(new Blob([bytes], { type: 'image/png' }));
  });
}

function download(bytes, type, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Retain the Blob URL through the browser download hand-off.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setReadout(id, value) {
  byId('proof-' + id).textContent = String(value);
}

function present({ proof, archivedPngChecked }, dataUrl) {
  verifiedProof = proof;
  image.src = dataUrl;
  image.alt = 'Independently regenerated FIELDWEAVER canonical artwork, ' +
    proof.crop.widthPx + ' by ' + proof.crop.heightPx + ' pixels, tick ' + proof.targetTick;
  image.hidden = false;
  placeholder.hidden = true;
  caption.textContent = 'Actual FW-012 software raster · ' + proof.crop.widthPx + '×' +
    proof.crop.heightPx + ' · tick ' + proof.targetTick + ' · raw ' + proof.rawRgbaHash;
  setReadout('recipe-hash', proof.recipeHash);
  setReadout('seed', proof.provenance.seed >>> 0);
  setReadout('tick', proof.targetTick);
  const crop = proof.crop;
  setReadout('crop', crop.widthPx + '×' + crop.heightPx + ' · ' +
    crop.unitsPerPixelQ16 + ' Q16 units/px · chunk ' +
    crop.center.chunkX + ',' + crop.center.chunkY +
    ' · local ' + crop.center.localX + ',' + crop.center.localY);
  setReadout('rgba-hash', proof.rawRgbaHash);
  setReadout('state-hash', proof.stateHash);
  setReadout('lineage', proof.provenance.lineage ?
    'Parent ' + proof.provenance.lineage.parentRecipeHash : 'Original / no lineage');
  setReadout('png-status', archivedPngChecked ?
    'Decoded RGBA8 matches independently replayed output, pixel for pixel.' :
    'Not supplied. Archived image bytes have NOT been verified.');
  byId('proof-verdict').textContent = archivedPngChecked ?
    'Receipt + archived PNG: verified' : 'Receipt replay: verified · archived PNG not checked';
  details.hidden = false;
  document.documentElement.dataset.fieldweaverProofDeskHash = proof.rawRgbaHash;
  report(archivedPngChecked ?
    'Verified: versioned receipt, canonical replay and every archived RGBA pixel agree.' :
    'Verified: versioned receipt agrees with independent canonical replay. No archived PNG was checked.',
  'verified');
}

provenanceInput.addEventListener('change', clear);
pngInput.addEventListener('change', clear);

verifyButton.addEventListener('click', async () => {
  clear();
  const token = generation;
  verifyButton.disabled = true;
  report('Checking input and reproducing canonical CPU pixels…', 'busy');
  try {
    const receiptFile = provenanceInput.files?.[0];
    const pngFile = pngInput.files?.[0] ?? null;
    if (!receiptFile) throw new Error('Select a canonical provenance JSON file.');
    if (receiptFile.size > PROOF_DESK_LIMITS.provenanceBytes) {
      throw new RangeError('Provenance exceeds the 4 MiB input budget.');
    }
    if (pngFile && pngFile.size > PROOF_DESK_LIMITS.pngBytes) {
      throw new RangeError('Archived PNG exceeds the 8 MiB input budget.');
    }
    const provenance = JSON.parse(await receiptFile.text());
    const pngBytes = pngFile ? new Uint8Array(await pngFile.arrayBuffer()) : null;
    // Allow the status to paint before synchronous integer canonical replay.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (token !== generation) return;
    const checked = verifyProofPackage(provenance, pngBytes);
    const url = await readAsDataUrl(checked.proof.png);
    if (token !== generation) return;
    present(checked, url);
  } catch (error) {
    if (token === generation) {
      report('Verification rejected: ' + (error?.message ?? String(error)), 'error');
    }
  } finally {
    verifyButton.disabled = false;
  }
});

pngDownload.addEventListener('click', () => {
  if (verifiedProof) {
    download(verifiedProof.png, 'image/png',
      'fieldweaver-replayed-' + verifiedProof.rawRgbaHash + '.png');
  }
});
receiptDownload.addEventListener('click', () => {
  if (verifiedProof) {
    download(new TextEncoder().encode(verifiedProof.provenanceJson), 'application/json',
      'fieldweaver-verified-' + verifiedProof.rawRgbaHash + '.fwexport.json');
  }
});

document.documentElement.dataset.fieldweaverProofDeskState = 'ready';
