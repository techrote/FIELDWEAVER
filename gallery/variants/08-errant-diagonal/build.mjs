// Reproducible FW-011 / FW-012 artwork; no core, preset or editor changes.
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { getBuiltinPreset } from '../../../src/presets/index.js';
import { mutateRecipe, readMutationLineage } from '../../../src/mutation/index.js';
import { parseRecipe, recipeHash, serializeRecipe } from '../../../src/recipe/index.js';
import { createCanonicalExport, encodePngRgba, rawRgbaHash } from '../../../src/export/index.js';

export const ATLAS_VERSION = 'fieldweaver-variant-atlas-v1';
export const PARENT_ID = 'operator-atlas';
export const FIRST_SEED = 0x4fa2197d;
export const SECOND_SEED = 0x8154c30a;
export const TICK = 136;
export const CROP = Object.freeze({
  widthPx: 224, heightPx: 168,
  center: Object.freeze({ chunkX: 0, chunkY: 0, localX: 128 * 65536, localY: 128 * 65536 }),
  unitsPerPixelQ16: 49152
});
const COUNT = 20;
const FINALISTS = 4;
const OUTPUT_OPTIONS = Object.freeze({ targetTick: TICK, crop: CROP, agentCapacity: 4096, maxDepositions: 250000 });
const BG = [9, 11, 8, 255];

function identify(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function analyze(image) {
  const { rgba } = image;
  const mask = new Uint8Array(CROP.widthPx * CROP.heightPx);
  const bins = new Set();
  let ink = 0, minX = CROP.widthPx, maxX = -1, minY = CROP.heightPx, maxY = -1;
  const quadrant = [0, 0, 0, 0];
  for (let y = 0; y < CROP.heightPx; y++) {
    for (let x = 0; x < CROP.widthPx; x++) {
      const i = y * CROP.widthPx + x, o = 4 * i;
      if (rgba[o] === BG[0] && rgba[o+1] === BG[1] && rgba[o+2] === BG[2]) continue;
      mask[i] = 1;
      ink++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      bins.add(Math.floor(y * 6 / CROP.heightPx) * 8 + Math.floor(x * 8 / CROP.widthPx));
      quadrant[(y >= CROP.heightPx / 2 ? 2 : 0) + (x >= CROP.widthPx / 2 ? 1 : 0)]++;
    }
  }
  const bbox = ink ? [minX, minY, maxX, maxY] : null;
  return { mask, ink, cells: bins.size, quadrant, bbox };
}
function maskXor(a, b) {
  let different = 0;
  for (let i = 0; i < a.length; i++) different += a[i] !== b[i];
  return different;
}
function shapeScore(m, parentXor) {
  // Reward spread, negative-space structure and topology, not colour differences.
  const occupiedQuadrants = m.quadrant.filter(Boolean).length;
  const safeInk = Math.min(m.ink, 4500);
  const thinnessPenalty = m.ink < 90 ? (90-m.ink)*10 : 0;
  return parentXor * 2 + m.cells * 42 + occupiedQuadrants * 105 + safeInk / 3 - thinnessPenalty;
}
function copyImage(dst, dw, src, sw, sh, ox, oy) {
  for (let y = 0; y < sh; y++)
    dst.set(src.subarray(y * sw * 4, (y + 1) * sw * 4), ((oy + y) * dw + ox) * 4);
}
const FONT = Object.freeze({
  'P': ['110', '101', '110', '100', '100'],
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['110', '001', '010', '100', '111'],
  '3': ['110', '001', '010', '001', '110'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '110', '001', '110'],
  '6': ['011', '100', '110', '101', '010'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['010', '101', '010', '101', '010'],
  '9': ['010', '101', '011', '001', '110'],
  'S': ['011', '100', '010', '001', '110']
});
function glyph(dst, dw, x, y, text) {
  let px=x;
  for(const char of text) {
    const rows = FONT[char] ?? FONT['0'];
    for(let dy=0;dy<5;dy++) for(let dx=0;dx<3;dx++) if(rows[dy][dx]==='1') {
      const off=((y+dy)*dw+px+dx)*4;
      dst[off]=193; dst[off+1]=196; dst[off+2]=176; dst[off+3]=255;
    }
    px+=5;
  }
}
function contactSheet(candidates) {
  const gap=12, top=25, columns=3, rows=2;
  const w=columns*CROP.widthPx+(columns+1)*gap;
  const h=rows*(CROP.heightPx+top)+(rows+1)*gap;
  const rgba=new Uint8Array(w*h*4);
  for(let o=0;o<rgba.length;o+=4) { rgba[o]=18;rgba[o+1]=20;rgba[o+2]=18;rgba[o+3]=255; }
  candidates.forEach((candidate,i)=>{
    const col=i%columns, row=Math.floor(i/columns);
    const x=gap+col*(CROP.widthPx+gap), y=gap+row*(CROP.heightPx+top+gap);
    glyph(rgba,w,x+4,y+7,candidate.label);
    copyImage(rgba,w,candidate.export.rgba,CROP.widthPx,CROP.heightPx,x,y+top);
  });
  return { png: encodePngRgba(rgba,w,h), rawRgbaHash:rawRgbaHash(rgba), widthPx:w,heightPx:h };
}
function canonical(exported) {
  return { recipeHash:exported.recipeHash, rawRgbaHash:exported.rawRgbaHash,
    stateHash:exported.stateHash, depositionHash:exported.depositionHash,
    resultHash:exported.resultHash, depositionCount:exported.depositionCount };
}
function asset(path, input) {
  const bytes=Buffer.isBuffer(input) ? input : Buffer.from(input);
  return { path, bytes, sha256:identify(bytes) };
}
export function buildAtlas() {
  const parent = getBuiltinPreset(PARENT_ID);
  const parentJSON = serializeRecipe(parent.recipe);
  const parentHash = recipeHash(parent.recipe);
  const parentExport = createCanonicalExport(parent.recipe, OUTPUT_OPTIONS);
  const pm = analyze(parentExport);
  const candidates = [];
  for (let i=0;i<COUNT;i++) {
    const firstConfig = { mutationSeed:FIRST_SEED, siblingIndex:i, scope:'all', intensity:'bold', operationCount:6 };
    const secondConfig = { mutationSeed:SECOND_SEED, siblingIndex:i, scope:'emitters', intensity:'bold', operationCount:1 };
    const first = mutateRecipe(parent.recipe, firstConfig);
    const second = mutateRecipe(first.recipe, secondConfig);
    const exported = createCanonicalExport(second.recipe, OUTPUT_OPTIONS);
    const m = analyze(exported);
    const parentXor = maskXor(pm.mask,m.mask);
    const score = shapeScore(m,parentXor);
    candidates.push({ i, first, second, export:exported, mask:m.mask, ink:m.ink,
      cells:m.cells, quadrant:m.quadrant, bbox:m.bbox, parentXor, score });
  }
  const uniquePixelIDs=new Set(candidates.map(c=>c.export.rawRgbaHash));
  if(uniquePixelIDs.size!==COUNT) throw new Error('Exact canonical pixel duplicate in 20-candidate family');
  const ranked=[...candidates].sort((a,b)=>b.score-a.score||a.i-b.i);
  const finalists=[];
  for(const candidate of ranked) {
    if(candidate.ink<90 || candidate.parentXor<140) continue;
    if(finalists.some(c=>maskXor(c.mask,candidate.mask)<140)) continue;
    finalists.push(candidate);
    if(finalists.length===FINALISTS) break;
  }
  if(finalists.length!==FINALISTS) throw new Error('Insufficient morphologically independent canonical finalists: '+finalists.length);
  // Artistic selection after inspecting the genuine CPU sheet: #03 maintains a
  // legible sheared bridge and a right-hand violet termination, whereas #15
  // maximizes mask change but loses too much compositional continuity.
  const selected=finalists.find(c=>c.i===3);
  if(!selected) throw new Error('Curated sibling 03 must survive geometric qualification');
  const panels=[{label:'P',export:parentExport},...finalists.map(c=>({label:(c.i===selected.i?'S':'')+String(c.i).padStart(2,'0'),export:c.export}))];
  const sheet=contactSheet(panels);
  const manifest={
    version:ATLAS_VERSION, title:'The Errant Diagonal',
    method:'two-stage exact FW-011 mutation / FW-012 CPU replay / mask-space curation',
    parent:{id:PARENT_ID,recipeHash:parentHash,seed:parent.recipe.seed,canonical:canonical(parentExport)},
    mutation:{firstSeed:FIRST_SEED,secondSeed:SECOND_SEED,
      first:{scope:'all',intensity:'bold',operationCount:6},
      second:{scope:'emitters',intensity:'bold',operationCount:1},
      siblingIndexes:[0,COUNT-1]},
    targetTick:TICK,crop:CROP,
    selection:{index:selected.i,recipeHash:recipeHash(selected.second.recipe),
      lineage:readMutationLineage(selected.second.recipe),canonical:canonical(selected.export),
      morphologicalScore:selected.score,maskXorFromParent:selected.parentXor},
    finalists:finalists.map(c=>({index:c.i,recipeHash:recipeHash(c.second.recipe),
      canonical:canonical(c.export),occupiedPixels:c.ink,occupiedGridCells:c.cells,
      bbox:c.bbox,quadrant:c.quadrant,maskXorFromParent:c.parentXor,score:c.score})),
    candidates:candidates.map(c=>({index:c.i,bridgeHash:c.first.childRecipeHash,
      childHash:c.second.childRecipeHash,rgbaHash:c.export.rawRgbaHash,
      occupiedPixels:c.ink,occupiedGridCells:c.cells,bbox:c.bbox,
      maskXorFromParent:c.parentXor,score:c.score})),
    sheet:{kind:'noncanonical-presentation-only',...{widthPx:sheet.widthPx,heightPx:sheet.heightPx,rawRgbaHash:sheet.rawRgbaHash}}
  };
  const files=[
    asset('selected.recipe.json',serializeRecipe(selected.second.recipe)),
    asset('selected.provenance.json',selected.export.provenanceJson),
    asset('selected.png',selected.export.png),
    asset('parent.png',parentExport.png),
    ...finalists.map(c=>asset('finalist-'+String(c.i).padStart(2,'0')+'.png',c.export.png)),
    asset('contact-sheet.png',sheet.png),
    asset('manifest.json',JSON.stringify(manifest,null,2)+'\n')
  ];
  // Distinguish archive bytes from the normalized canonical image hashes in manifest.
  const archive={...manifest,files:files.slice(0,-1).map(({path,sha256,bytes})=>({path,sha256,bytes:bytes.length}))};
  files[files.length-1]=asset('manifest.json',JSON.stringify(archive,null,2)+'\n');
  if(serializeRecipe(parseRecipe(files[0].bytes.toString())) !== files[0].bytes.toString())
    throw new Error('selected recipe did not survive normalized roundtrip');
  if(recipeHash(parent.recipe)!==recipeHash(JSON.parse(parentJSON)))
    throw new Error('immutable parent changed');
  return { files, archive, candidates, finalists, selected, parent, sheet };
}
export async function writeAtlas() {
  const base=dirname(fileURLToPath(import.meta.url)), built=buildAtlas();
  await mkdir(base,{recursive:true});
  for(const f of built.files) await writeFile(join(base,f.path),f.bytes);
  return built;
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  const built=await writeAtlas();
  console.log('FW-ATLAS BUILT selected #'+built.selected.i+' '+built.selected.export.rawRgbaHash+
    ' / '+built.files.length+' canonical/evidence files; contact sheet presentation-only');
}
