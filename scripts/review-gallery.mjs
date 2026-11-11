// Offline human-review entrypoint; this is not the accepted exhibition catalog.
// Every candidate image is replayed through the authoritative CPU exporter and
// compared against its archived decoded pixels and versioned provenance.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createCanonicalExport, decodePngRgba } from '../src/export/index.js';
import { getBuiltinPreset } from '../src/presets/index.js';
import { renderExhibitionProof } from '../src/ui/exhibition-catalog.js';

const MAX_CANDIDATES = 8;
const MAX_PROVENANCE_BYTES = 8 * 1024 * 1024;
const MAX_TICK = 512;
const MAX_AXIS = 1024;
const MAX_PIXELS = 1_048_576;
const CAPACITY = 4096;
const MAX_DEPOSITIONS = 250_000;

function requireIdentity(condition, reason) {
  if (!condition) throw new Error('Candidate verification failed: ' + reason);
}

export function verifyCandidate(provenance, archivedPng) {
  requireIdentity(provenance !== null && typeof provenance === 'object' && !Array.isArray(provenance), 'missing provenance object');
  requireIdentity(provenance.version === 'fw-export-provenance-v1', 'incompatible provenance version');
  requireIdentity(provenance.exportVersion === 'fw-canonical-export-v1', 'incompatible export version');
  requireIdentity(provenance.pixelFormat === 'rgba8', 'unsupported pixel format');
  requireIdentity(Number.isInteger(provenance.targetTick) && provenance.targetTick >= 0 && provenance.targetTick <= MAX_TICK, 'tick exceeds review budget [0,512]');
  const crop = provenance.crop;
  requireIdentity(crop && Number.isInteger(crop.widthPx) && Number.isInteger(crop.heightPx) &&
    crop.widthPx > 0 && crop.heightPx > 0 &&
    crop.widthPx <= MAX_AXIS && crop.heightPx <= MAX_AXIS &&
    crop.widthPx * crop.heightPx <= MAX_PIXELS, 'crop exceeds review pixel budget');
  requireIdentity(archivedPng instanceof Uint8Array, 'archived canonical PNG is required');

  const proof = createCanonicalExport(provenance.recipe, {
    targetTick: provenance.targetTick,
    crop,
    backgroundRgba8: provenance.backgroundRgba8,
    agentCapacity: CAPACITY,
    maxDepositions: MAX_DEPOSITIONS,
    tileWidthPx: 47,
    tileHeightPx: 39
  });
  // Compare all semantic identities, rather than trusting artist-supplied
  // hashes, project names, screenshots, or PNG compression.
  const identityFields = [
    'version', 'exportVersion', 'rasterVersion', 'pngVersion',
    'recipeHash', 'seed', 'schemaVersion', 'engineVersion',
    'targetTick', 'crop', 'widthPx', 'heightPx', 'unitsPerPixelQ16',
    'backgroundRgba8', 'pixelFormat', 'rawRgbaHash', 'stateHash',
    'depositionHash', 'resultHash', 'lineage'
  ];
  for (const field of identityFields) {
    requireIdentity(
      assertIdentity(provenance[field], proof.provenance[field]),
      field + ' differs from exact CPU replay'
    );
  }
  const archived = decodePngRgba(archivedPng);
  requireIdentity(archived.widthPx === crop.widthPx && archived.heightPx === crop.heightPx, 'archived PNG dimensions differ');
  requireIdentity(
    Buffer.from(archived.rgba).equals(Buffer.from(proof.rgba)),
    'archived PNG decoded RGBA8 differs from exact CPU replay'
  );
  return proof;
}

function assertIdentity(a, b) {
  try { assert.deepStrictEqual(a, b); return true; } catch { return false; }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function titleFromPath(path) {
  const stem = basename(path).replace(/\.provenance\.json$/, '');
  const value = stem === 'selected' ? basename(dirname(path)) : stem;
  return value.replace(/^\d+[-_]/, '').replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function displayCrop(crop) {
  const c = crop.center;
  return crop.widthPx + ' × ' + crop.heightPx + ' · Q16 units/px ' +
    crop.unitsPerPixelQ16 + ' · centre chunks (' + c.chunkX + ', ' + c.chunkY +
    '), local Q16 (' + c.localX + ', ' + c.localY + ')';
}

function identityRow(label, value) {
  return '<dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value) + '</dd>';
}

export function renderReviewHtml(entries) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_CANDIDATES) {
    throw new RangeError('Review requires 1–8 verified entries.');
  }
  const occurrences = new Map();
  for (const entry of entries) {
    const key = entry.proof.crop.widthPx + 'x' + entry.proof.crop.heightPx +
      ':' + entry.proof.rawRgbaHash;
    occurrences.set(key, (occurrences.get(key) || 0) + 1);
  }
  const navigation = entries.map((entry, index) =>
    '<a href="#work-' + (index + 1) + '">' + escapeHtml(entry.title) + '</a>'
  ).join('');
  const cards = entries.map((entry, index) => {
    const p = entry.proof.provenance;
    const image = 'data:image/png;base64,' + Buffer.from(entry.proof.png).toString('base64');
    const recipe = 'data:application/json;base64,' +
      Buffer.from(JSON.stringify(p.recipe, null, 2) + '\n').toString('base64');
    const provenance = 'data:application/json;base64,' +
      Buffer.from(entry.proof.provenanceJson).toString('base64');
    const key = entry.proof.crop.widthPx + 'x' + entry.proof.crop.heightPx +
      ':' + entry.proof.rawRgbaHash;
    const duplicate = occurrences.get(key) > 1;
    const lineage = p.lineage ? (p.lineage.parentRecipeHash || 'present') : 'original / no parent';
    return [
      '<article id="work-', index + 1, '" class="work">',
      '<header><p class="state">', entry.accepted ? 'ACCEPTED PRESET' : 'UNMERGED CANDIDATE',
      '</p><h2>', escapeHtml(entry.title), '</h2></header>',
      '<figure><img loading="lazy" src="', image, '" width="', p.widthPx,
      '" height="', p.heightPx, '" alt="Canonical software-rendered composition ', escapeHtml(entry.title),
      ', ', p.widthPx, ' by ', p.heightPx, ' pixels at tick ', p.targetTick,
      '"><figcaption>CPU replay · decoded RGBA8 verified',
      entry.accepted ? ' against accepted preset' : ' against archived PNG and provenance',
      '</figcaption></figure>',
      duplicate ? '<p class="warning">Duplicate image identity within this review.</p>' : '',
      '<p class="actions"><a href="', image, '" download="fieldweaver-work-', index + 1,
      '.png">Save canonical PNG</a><a href="', recipe, '" download="fieldweaver-work-', index + 1,
      '.recipe.json">Save recipe</a><a href="', provenance, '" download="fieldweaver-work-', index + 1,
      '.provenance.json">Save provenance</a></p>',
      '<details><summary>Identity, lineage and exact framing</summary><dl>',
      identityRow('Source', entry.source),
      identityRow('Seed (unsigned)', p.seed),
      identityRow('Target tick', p.targetTick),
      identityRow('Crop', displayCrop(p.crop)),
      identityRow('Recipe FNV64', p.recipeHash),
      identityRow('Decoded RGBA8 FNV64', p.rawRgbaHash),
      identityRow('State FNV64', p.stateHash),
      identityRow('Deposition FNV64', p.depositionHash),
      identityRow('Result FNV64', p.resultHash),
      identityRow('Parent recipe', lineage),
      '</dl></details></article>'
    ].join('');
  }).join('\n');
  const css = [
    ':root{color-scheme:dark;background:#111511;color:#e6e8df;font:15px/1.5 system-ui,sans-serif}',
    '*{box-sizing:border-box}body{margin:0;min-height:100vh}',
    'main{max-width:1500px;margin:auto;padding:clamp(16px,3vw,48px)}',
    'h1{font-size:clamp(1.7rem,3vw,2.5rem);letter-spacing:-.03em;margin:.3em 0}',
    'h2{font-size:1.15rem;line-height:1.2;margin:.2em 0 1em}',
    'p{margin:.4em 0 1em}.intro{max-width:76ch;color:#abb5aa}',
    'nav{display:flex;gap:.6rem;flex-wrap:wrap;padding:1rem 0 1.4rem}',
    'a{color:#b8d7b4;text-underline-offset:3px}',
    'nav a,.actions a{border:1px solid #526052;padding:.5em .75em;text-decoration:none}',
    'a:hover,a:focus-visible,summary:focus-visible{outline:2px solid #d6c38b;outline-offset:3px}',
    '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,410px),1fr));gap:1.2rem;align-items:start}',
    '.work{min-width:0;background:#1c211d;border:1px solid #485047;padding:1rem}',
    '.state{font-size:.72rem;color:#d6c38b;letter-spacing:.12em;font-weight:700}',
    'figure{margin:0;background:#090b08;border:1px solid #333d33;padding:.5rem}',
    'figure img{width:100%;height:auto;max-height:66vh;object-fit:contain;display:block;image-rendering:auto}',
    'figcaption{margin:.6rem 0 .1rem;font-size:.8rem;color:#aeb7aa}',
    '.actions{display:flex;flex-wrap:wrap;gap:.5rem;font-size:.83rem;margin:1rem 0}',
    'details{border-top:1px solid #485047;padding-top:.7rem}',
    'summary{cursor:pointer;font-weight:600}dl{display:grid;grid-template-columns:minmax(110px,35%) 1fr;gap:.4rem .8rem}',
    'dt{color:#aeb7aa}dd{margin:0;overflow-wrap:anywhere;font: .82rem/1.5 ui-monospace,monospace}',
    '.warning{color:#f2c18e}footer{margin-top:2rem;color:#adb5aa;font-size:.85rem}'
  ].join('\n');
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src data:; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">',
    '<title>FIELDWEAVER · Canonical artwork review</title><style>', css, '</style></head><body>',
    '<main><header><p class="state">FIELDWEAVER · OFFLINE CURATORIAL REVIEW</p>',
    '<h1>Artwork selection</h1><p class="intro">Every image on this page was regenerated from its versioned recipe using the actual canonical CPU software exporter. Candidate PNGs and provenance were independently checked against decoded pixels and replay hashes. A candidate is not an accepted catalog entry. This page is a review document, not a simulation renderer.</p>',
    '</header><nav aria-label="Jump to artwork">', navigation, '</nav>',
    '<section class="grid" aria-label="Verified canonical artworks">', cards, '</section>',
    '<footer>No network resources, telemetry, scripts, or noncanonical preview images. Full recipes, seeds, ticks and crops are available under each work.</footer></main></body></html>\n'
  ].join('');
}

async function verifiedCandidateAt(path) {
  requireIdentity(path.endsWith('.provenance.json'), 'pass a .provenance.json sidecar path');
  const metadata = await readFile(path);
  requireIdentity(metadata.length <= MAX_PROVENANCE_BYTES, 'provenance exceeds 8 MiB input limit');
  const provenance = JSON.parse(metadata.toString('utf8'));
  const imagePath = path.replace(/\.provenance\.json$/, '.png');
  const archive = await readFile(imagePath); // missing archives fail closed
  return {
    title: titleFromPath(path),
    accepted: false,
    source: basename(path) + ' + ' + basename(imagePath),
    proof: verifyCandidate(provenance, archive)
  };
}

export async function runCli(argv) {
  const inputs = [];
  let output = null;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!['--out', '--preset', '--provenance'].includes(flag) || !argv[index + 1]) {
      throw new Error('Usage: node scripts/review-gallery.mjs --out review.html [--preset first-weave] [--provenance path/to/work.provenance.json] ...');
    }
    const value = argv[++index];
    if (flag === '--out') {
      if (output !== null) throw new Error('Supply --out exactly once.');
      output = resolve(value);
    } else {
      inputs.push({ type: flag, value });
    }
  }
  if (!output || inputs.length < 1 || inputs.length > MAX_CANDIDATES) {
    throw new Error('One output path and 1–8 artwork entries are required.');
  }
  const entries = [];
  for (const input of inputs) {
    if (input.type === '--preset') {
      const preset = getBuiltinPreset(input.value);
      entries.push({
        title: preset.name,
        accepted: true,
        source: 'FW-014 immutable accepted preset: ' + preset.id,
        proof: renderExhibitionProof(preset.id)
      });
    } else {
      entries.push(await verifiedCandidateAt(resolve(input.value)));
    }
  }
  await writeFile(output, renderReviewHtml(entries), { flag: 'wx' });
  return { output, entries: entries.map((entry) => ({
    title: entry.title, accepted: entry.accepted,
    recipeHash: entry.proof.recipeHash, rawRgbaHash: entry.proof.rawRgbaHash
  })) };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runCli(process.argv.slice(2)).then((result) => {
    console.log('Verified offline artwork review: ' + result.output);
    for (const entry of result.entries) {
      console.log((entry.accepted ? 'accepted ' : 'candidate ') + entry.title +
        ' · ' + entry.recipeHash + ' · RGBA ' + entry.rawRgbaHash);
    }
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
