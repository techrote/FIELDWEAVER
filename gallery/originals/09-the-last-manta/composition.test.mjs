// Artwork-specific archive and offline exhibition admission gate.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {qualify,isArchived} from './qualify.mjs';
import {runCli} from '../../../scripts/review-gallery.mjs';

test('Original 09: complete archived canonical FW-012 recipe/replay/crop/tile and byte identity',async()=>{
  assert.equal(isArchived(),true,'Finished original 09 requires all four committed canonical artifacts');
  const {receipt}=await qualify({archived:true});
  assert.equal(receipt.seed,0x519af26d);
  assert.equal(receipt.recipeHash,'95974bbaa3279204');
  assert.equal(receipt.targetTick,166);
  assert.equal(receipt.crop.widthPx,480);
  assert.equal(receipt.crop.heightPx,320);
  assert.equal(receipt.rawRgbaHash,'5a819a6ffd149c9e');
  console.log('FW9ARCHIVED_RECEIPT '+JSON.stringify(receipt));
});

test('Original 09: actual canonical candidate enters offline accepted-preset comparison unchanged',async()=>{
  assert.equal(isArchived(),true,'Review cannot silently fall back to an unfinished candidate');
  const folder=await mkdtemp(join(tmpdir(),'fieldweaver-manta-review-'));
  try {
    const out=join(folder,'compare.html');
    const sidecar=fileURLToPath(new URL('./the-last-manta.provenance.json',import.meta.url));
    const result=await runCli([
      '--out',out,
      '--preset','operator-atlas',
      '--preset','timeline-pulse',
      '--provenance',sidecar
    ]);
    assert.deepEqual(result.entries.map(e=>e.accepted),[true,true,false]);
    const candidate=result.entries[2];
    assert.equal(candidate.recipeHash,'95974bbaa3279204');
    assert.equal(candidate.rawRgbaHash,'5a819a6ffd149c9e');
    const html=await readFile(out,'utf8');
    assert.match(html,/UNMERGED CANDIDATE/);
    assert.match(html,/ACCEPTED PRESET/);
    assert.match(html,/Identity, lineage and exact framing/);
    assert.match(html,/data:application\/json;base64,/);
    assert.doesNotMatch(html,/<script\b|<iframe\b|src="https?:|href="https?:/i);
    const imageData=[...html.matchAll(/<img[^>]+src="data:image\/png;base64,([^"]+)"/g)];
    assert.equal(imageData.length,3,'Two CPU accepted proofs and one archived candidate');
    const archived=await readFile(new URL('./the-last-manta.png',import.meta.url));
    assert.deepEqual(Buffer.from(imageData[2][1],'base64'),archived,
      'Offline review must embed the exact archived canonical PNG bytes');
  }finally{
    await rm(folder,{recursive:true,force:true});
  }
});
