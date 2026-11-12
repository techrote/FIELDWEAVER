// Artwork-local wrapper: reuse the verified offline CPU exhibition.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCli } from '../../../scripts/review-gallery.mjs';

const provenance = fileURLToPath(new URL('./the-luminous-ledger.provenance.json', import.meta.url));
export async function createLedgerReview(output = null) {
  const destination = output ?? join(await mkdtemp(join(tmpdir(), 'fieldweaver-ledger-review-')), 'review.html');
  const result = await runCli([
    '--out', destination, '--preset', 'operator-atlas',
    '--preset', 'timeline-pulse', '--provenance', provenance
  ]);
  if (result.entries.length !== 3 ||
      result.entries.map((entry) => entry.accepted).join(',') !== 'true,true,false' ||
      result.entries[2].recipeHash !== 'e60f9467e69750b9' ||
      result.entries[2].rawRgbaHash !== '3b821e3737598e0a') {
    throw new Error('Original 02 offline review identity or admission mismatch');
  }
  return { ...result, url: pathToFileURL(result.output).href };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    console.error('Usage: node gallery/originals/02-the-luminous-ledger/review.mjs');
    process.exitCode = 2;
  } else {
    createLedgerReview().then((result) => {
      console.log('VERIFIED ORIGINAL 02: ' + result.url);
      console.log('Open directly in Firefox. Ledger remains an UNMERGED CANDIDATE.');
      console.log('Download and import recipe in 0Play; seed 0x6b51e7d3; tick 168; crop 448x448; RGBA8 3b821e3737598e0a.');
    }).catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}
