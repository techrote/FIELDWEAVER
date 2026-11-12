// Artwork-local shortcut to the already accepted, replay-verifying offline board.
// It never changes the accepted catalog or any canonical artwork bytes.
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCli } from '../../../scripts/review-gallery.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function buildReview(outputPath = 'fw-unwound-metronome-review.html') {
  return runCli([
    '--out', resolve(outputPath),
    '--preset', 'timeline-pulse',
    '--preset', 'operator-atlas',
    '--provenance', join(HERE, 'selected.provenance.json')
  ]);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  buildReview(process.argv[2]).then(({ output, entries }) => {
    console.log('Verified offline comparison: ' + output);
    for (const entry of entries) {
      console.log((entry.accepted ? 'ACCEPTED ' : 'UNMERGED ') +
        entry.title + ' · RGBA8 ' + entry.rawRgbaHash);
    }
    console.log('Open the HTML directly in Firefox; import candidate recipe in the live editor to finish physical acceptance.');
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
