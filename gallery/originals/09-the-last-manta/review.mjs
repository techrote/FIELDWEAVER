// Original 09's one-command entrypoint to FIELDWEAVER's existing offline reviewer.
// No new gallery, catalog admission, altered image or revised recipe.
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runCli} from '../../../scripts/review-gallery.mjs';

const sidecar=fileURLToPath(new URL('./the-last-manta.provenance.json',import.meta.url));

export async function createMantaReview(output=null){
  const destination=output ?? join(
    await mkdtemp(join(tmpdir(),'fieldweaver-manta-review-')),
    'manta-review.html');
  const result=await runCli([
    '--out',destination,
    '--preset','operator-atlas',
    '--preset','timeline-pulse',
    '--provenance',sidecar
  ]);
  assert.deepEqual(result.entries.map(entry=>entry.accepted),[true,true,false],
    'Unadmitted Manta must never appear as an accepted preset');
  const candidate=result.entries[2];
  assert.equal(candidate.recipeHash,'95974bbaa3279204',
    'Original 09 authored recipe changed');
  assert.equal(candidate.rawRgbaHash,'5a819a6ffd149c9e',
    'Original 09 canonical CPU image changed');
  return {...result,url:pathToFileURL(result.output).href};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==2){
    console.error('Usage: node gallery/originals/09-the-last-manta/review.mjs');
    process.exitCode=2;
  }else{
    createMantaReview().then(result=>{
      console.log('VERIFIED ORIGINAL 09 REVIEW: '+result.url);
      console.log('Open in Firefox; candidate is UNMERGED, not in the accepted catalog.');
      console.log('Save candidate recipe and Load recipe in FIELDWEAVER to inspect/export.');
      console.log('Seed 0x519af26d · tick 166 · 480x320 · RGBA8 5a819a6ffd149c9e');
    }).catch(error=>{console.error(error.message);process.exitCode=1;});
  }
}
