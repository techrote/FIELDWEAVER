// Artwork-local launcher for the existing CPU-verified offline review generator.
// A proposed original is never promoted to an accepted preset by this tool.
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runCli} from '../../../scripts/review-gallery.mjs';

const provenance=fileURLToPath(new URL('./the-zero-meridian.provenance.json',import.meta.url));

export async function createZeroMeridianReview(output=null){
  // Fresh create-only location; previous owner review files are never overwritten.
  const destination=output ?? join(
    await mkdtemp(join(tmpdir(),'fieldweaver-meridian-review-')),
    'meridian-review.html');
  const result=await runCli([
    '--out',destination,
    '--preset','operator-atlas',
    '--preset','timeline-pulse',
    '--provenance',provenance
  ]);
  if(result.entries.length!==3 ||
     result.entries.map(entry=>entry.accepted).join(',')!=='true,true,false' ||
     result.entries[2].recipeHash!=='002a783e5492a7d5' ||
     result.entries[2].rawRgbaHash!=='20d0367ebe3a8d8e'){
    throw new Error('Original 07 review identity or admission state mismatch');
  }
  return {...result,url:pathToFileURL(result.output).href};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==2){
    console.error('Usage: node gallery/originals/07-the-zero-meridian/review.mjs');
    process.exitCode=2;
  }else{
    createZeroMeridianReview().then(result=>{
      console.log('VERIFIED ORIGINAL 07: '+result.url);
      console.log('Open in Firefox. Save the UNMERGED CANDIDATE recipe and import it via Load recipe.');
      console.log('Seed 0x5ce73a19 · tick 154 · 352x288 · RGBA8 20d0367ebe3a8d8e');
    }).catch(error=>{console.error(error.message);process.exitCode=1;});
  }
}
