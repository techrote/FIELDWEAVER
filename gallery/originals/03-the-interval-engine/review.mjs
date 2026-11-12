// Artwork-local entrypoint to the existing verified offline exhibition.
// No viewer, renderer, accepted catalogue, or source artwork changes.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCli } from '../../../scripts/review-gallery.mjs';

const provenance = fileURLToPath(new URL('./the-interval-engine.provenance.json', import.meta.url));

export async function createIntervalReview(output = null) {
  const destination = output ?? join(
    await mkdtemp(join(tmpdir(), 'fieldweaver-interval-review-')),
    'interval-review.html'
  );
  const result = await runCli([
    '--out', destination,
    '--preset', 'operator-atlas',
    '--preset', 'timeline-pulse',
    '--provenance', provenance
  ]);
  if (result.entries.length !== 3 ||
      result.entries.map((entry) => entry.accepted).join(',') !== 'true,true,false' ||
      result.entries[2].recipeHash !== '4adb2abba8c7999f' ||
      result.entries[2].rawRgbaHash !== 'fd389a9bb0ce640f') {
    throw new Error('Original 03 review exact-source identity or admission state mismatch');
  }
  return { ...result, url: pathToFileURL(result.output).href };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    console.error('Usage: node gallery/originals/03-the-interval-engine/review.mjs');
    process.exitCode = 2;
  } else {
    createIntervalReview().then((result) => {
      console.log('VERIFIED ORIGINAL 03: ' + result.url);
      console.log('Open in Firefox. The Interval Engine remains an UNMERGED CANDIDATE.');
      console.log('Save the recipe and import in 0Play. Seed 0x59a11e73; tick 176; crop 512x384; decoded RGBA8 fd389a9bb0ce640f.');
    }).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
