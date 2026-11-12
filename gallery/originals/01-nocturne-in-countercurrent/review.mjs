// Artwork-local offline review. Reuses FIELDWEAVER's canonical CPU gallery verifier.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCli } from '../../../scripts/review-gallery.mjs';

const provenance = fileURLToPath(new URL('./nocturne-in-countercurrent.provenance.json', import.meta.url));

export async function createNocturneReview(output = null) {
  const destination = output ?? join(await mkdtemp(join(tmpdir(), 'fieldweaver-nocturne-review-')), 'review.html');
  const result = await runCli([
    '--out', destination,
    '--preset', 'operator-atlas',
    '--preset', 'timeline-pulse',
    '--provenance', provenance
  ]);
  if (result.entries.length !== 3 ||
      result.entries.map((entry) => entry.accepted).join(',') !== 'true,true,false' ||
      result.entries[2].recipeHash !== 'ee1696765f96ef0c' ||
      result.entries[2].rawRgbaHash !== '1427da2094a6b26a') {
    throw new Error('Original 01 review identity or admission status mismatch');
  }
  return { ...result, url: pathToFileURL(result.output).href };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    console.error('Usage: node gallery/originals/01-nocturne-in-countercurrent/review.mjs');
    process.exitCode = 2;
  } else {
    createNocturneReview().then((result) => {
      console.log('VERIFIED ORIGINAL 01: ' + result.url);
      console.log('Open directly in Firefox. Nocturne is an UNMERGED CANDIDATE.');
      console.log('Download and import its recipe in 0Play; seed 0x77d5e2a1; tick 156; crop 512x320; RGBA8 1427da2094a6b26a.');
    }).catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}
