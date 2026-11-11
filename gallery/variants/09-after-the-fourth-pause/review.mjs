// Artwork-local shortcut to the existing exact-CPU-replay offline exhibition.
// This does not modify the accepted catalog, selected artwork, or export semantics.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCli } from '../../../scripts/review-gallery.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function buildReview(outputPath = 'fw-after-fourth-pause-review.html') {
  return runCli([
    '--out', resolve(outputPath),
    '--preset', 'timeline-pulse',
    '--preset', 'operator-atlas',
    '--provenance', join(HERE, 'selected.provenance.json')
  ]);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  buildReview(process.argv[2]).then(({ output, entries }) => {
    console.log('Verified offline canonical review: ' + pathToFileURL(output).href);
    for (const entry of entries) {
      console.log((entry.accepted ? 'ACCEPTED ' : 'UNADMITTED ') +
        entry.title + ' · recipe ' + entry.recipeHash +
        ' · RGBA8 ' + entry.rawRgbaHash);
    }
    console.log('Open the HTML in Firefox. Download the proposed recipe to import in the editor; no artistic admission is implied.');
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
