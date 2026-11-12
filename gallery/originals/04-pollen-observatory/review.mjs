// Artwork-local link to FIELDWEAVER's existing provenance-gated offline review.
// No new viewer, renderer, acceptance record or canonical artwork is created.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCli } from '../../../scripts/review-gallery.mjs';

const provenance = fileURLToPath(new URL('./pollen-observatory.provenance.json', import.meta.url));

export async function createPollenReview(output = null) {
  const destination = output ?? join(
    await mkdtemp(join(tmpdir(), 'fieldweaver-pollen-review-')),
    'pollen-review.html'
  );
  const result = await runCli([
    '--out', destination,
    '--preset', 'operator-atlas',
    '--preset', 'timeline-pulse',
    '--provenance', provenance
  ]);
  if (result.entries.length !== 3 ||
      result.entries.map((entry) => entry.accepted).join(',') !== 'true,true,false' ||
      result.entries[2].recipeHash !== '5cdf27d4b0c2e205' ||
      result.entries[2].rawRgbaHash !== '194610dd7ca77ca1') {
    throw new Error('Original 04 review source identity or admission state mismatch');
  }
  return { ...result, url: pathToFileURL(result.output).href };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    console.error('Usage: node gallery/originals/04-pollen-observatory/review.mjs');
    process.exitCode = 2;
  } else {
    createPollenReview().then((result) => {
      console.log('VERIFIED ORIGINAL 04: ' + result.url);
      console.log('Open in Firefox. The Pollen Observatory is an UNMERGED CANDIDATE, not an accepted preset.');
      console.log('Save and import the candidate recipe into 0Play; tick 176, 576x384, RGBA8 194610dd7ca77ca1.');
    }).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
