// Artwork-local launcher for the existing, strictly verified offline exhibition.
// This does not admit the proposal, alter recipes, or define a new viewer.
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runCli} from '../../../scripts/review-gallery.mjs';

const provenance=fileURLToPath(new URL('./the-vacant-rooms.provenance.json',import.meta.url));

export async function createRoomsReview(output=null){
  // The review builder is intentionally create-only. Each default invocation
  // gets a new scratch directory, preserving earlier owner evaluations.
  const destination=output ?? join(
    await mkdtemp(join(tmpdir(),'fieldweaver-rooms-review-')),
    'rooms-review.html');
  const result=await runCli([
    '--out',destination,
    '--preset','operator-atlas',
    '--preset','timeline-pulse',
    '--provenance',provenance
  ]);
  if(result.entries.length!==3 ||
     result.entries.map(entry=>entry.accepted).join(',')!=='true,true,false' ||
     result.entries[2].recipeHash!=='3a2c43dd7f49d9aa' ||
     result.entries[2].rawRgbaHash!=='56286fc4c1a47bb8'){
    throw new Error('Original 08 review identity or admission state mismatch');
  }
  return {...result,url:pathToFileURL(result.output).href};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==2){
    console.error('Usage: node gallery/originals/08-registry-of-vacant-rooms/review.mjs');
    process.exitCode=2;
  }else{
    createRoomsReview().then(result=>{
      console.log('VERIFIED ORIGINAL 08: '+result.url);
      console.log('Open this file URL in Firefox. Save recipe from the UNMERGED CANDIDATE card;');
      console.log('import it into the local FIELDWEAVER editor with Load recipe.');
      console.log('Seed 0x6da27f19 · canonical tick 162 · 432x304 · RGBA8 56286fc4c1a47bb8');
    }).catch(error=>{console.error(error.message);process.exitCode=1;});
  }
}
