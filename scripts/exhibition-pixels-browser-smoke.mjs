import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseRecipe, recipeHash } from '../src/recipe/index.js';
import { exhibitionEntries } from '../src/ui/exhibition-catalog.js';
import { renderVisualIndexProof } from '../src/ui/exhibition-visual-index-model.js';
import { pathToFileURL } from 'node:url';
import { decodePngRgba, rawRgbaHash } from '../src/export/index.js';

const browser = process.argv[2] ?? 'firefox';
if (!['chrome', 'firefox'].includes(browser)) throw new Error('Expected chrome or firefox.');
const executable = browser === 'chrome' ? 'chromedriver' : 'geckodriver';
if (spawnSync('bash', ['-lc', 'command -v ' + executable], { encoding: 'utf8' }).status !== 0) {
  throw new Error(executable + ' unavailable; no browser result may be claimed.');
}
const port = browser === 'chrome' ? 9531 : 9532;
const downloadDir = resolve('exhibition-offline-downloads-' + browser);
await mkdir(downloadDir, { recursive: true });
const driver = spawn(executable, browser === 'chrome' ? ['--port=' + port] : ['--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
let driverLog = '';
driver.stdout.on('data', (data) => { driverLog += String(data); });
driver.stderr.on('data', (data) => { driverLog += String(data); });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(method, path, body) {
  const response = await fetch('http://127.0.0.1:' + port + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const value = await response.json();
  if (!response.ok || value?.value?.error) throw new Error(method + ' ' + path + ': ' + JSON.stringify(value).slice(0, 800));
  return value;
}
let sessionId = null;
try {
  let online = false;
  for (let i = 0; i < 100; i += 1) {
    try { await request('GET', '/status'); online = true; break; } catch { await sleep(150); }
  }
  if (!online) throw new Error('WebDriver did not start: ' + driverLog);
  const desired = browser === 'chrome'
    ? { capabilities: { alwaysMatch: { browserName: 'chrome', 'goog:chromeOptions': { args: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader'], prefs: { 'download.default_directory': downloadDir, 'download.prompt_for_download': false, 'download.directory_upgrade': true } } } } }
    : { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { args: process.env.DISPLAY ? [] : ['-headless'], prefs: { 'webgl.disabled': false, 'webgl.force-enabled': true, 'gfx.webrender.software': true, 'browser.download.dir': downloadDir, 'browser.download.folderList': 2, 'browser.download.useDownloadDir': true, 'browser.helperApps.neverAsk.saveToDisk': 'application/json,application/octet-stream,image/png,application/zip,application/x-zip-compressed', 'browser.download.alwaysOpenPanel': false } } } } };
  const created = await request('POST', '/session', desired);
  sessionId = created?.value?.sessionId ?? created?.sessionId;
  if (!sessionId) throw new Error('Missing WebDriver session ID.');
  await request('POST', '/session/' + sessionId + '/url', { url: 'http://127.0.0.1:4173/' });
  const execute = async (script) => (await request('POST', '/session/' + sessionId + '/execute/sync', { script, args: [] }))?.value;
  let ready = false;
  for (let i = 0; i < 100; i += 1) {
    ready = await execute("return document.querySelector('.preset-panel')?.dataset.visualIndexReady === 'true'");
    if (ready) break;
    await sleep(200);
  }
  if (!ready) throw new Error('Accepted gallery visual index failed to mount.');
  const initial = await execute("return {cards:document.querySelectorAll('.exhibition-index-image').length,visible:document.querySelectorAll('.exhibition-index-image:not([hidden])').length}");
  if (initial.cards !== 4 || initial.visible !== 0) throw new Error('Fabricated or missing initial images: ' + JSON.stringify(initial));
  await execute("document.getElementById('exhibition-index-render').click()");
  let result;
  for (let i = 0; i < 160; i += 1) {
    result = await execute("return {status:document.getElementById('exhibition-index-status').textContent,tiles:[...document.querySelectorAll('.exhibition-card')].map(c=>({id:c.dataset.exhibitionId,hash:c.dataset.canonicalRgbaHash||'',shown:!c.querySelector('img').hidden,width:c.querySelector('img').naturalWidth,height:c.querySelector('img').naturalHeight,src:c.querySelector('img').getAttribute('src')||''}))}");
    if (result.status.includes('ready:') || result.status.includes('stopped')) break;
    await sleep(250);
  }
  if (!result?.status.includes('ready: 4/4') || result.tiles.length !== 4 ||
      result.tiles.some((tile) => !/^[a-f0-9]{16}$/.test(tile.hash) || !tile.shown ||
        tile.width !== 96 || tile.height !== 64 || !tile.src.startsWith('blob:'))) {
    throw new Error('Actual CPU image decoding failed: ' + JSON.stringify(result));
  }
  const selected = await execute("document.querySelector('[data-exhibition-id=\"operator-atlas\"]').click(); return {id:document.getElementById('preset-select').value,pressed:document.querySelector('.exhibition-card[aria-pressed=\"true\"]')?.dataset.exhibitionId,images:document.querySelectorAll('.exhibition-index-image:not([hidden])').length,proof:document.documentElement.dataset.fieldweaverExhibitionProofHash||''}");
  if (selected.id !== 'operator-atlas' || selected.pressed !== 'operator-atlas' ||
      selected.images !== 4 || selected.proof) {
    throw new Error('Gallery selection broke the accepted editor/proof workflow: ' + JSON.stringify(selected));
  }
  // The study reel displays only images decoded by the authoritative CPU index.
  const launchDisabled = await execute("return document.getElementById('exhibition-study-launch')?.disabled");
  if (launchDisabled !== false) throw new Error('Study is unavailable after four verified CPU proofs.');
  const opened = await execute("document.getElementById('exhibition-study-launch').click(); return {open:document.getElementById('exhibition-study-dialog').open,status:document.getElementById('exhibition-study-status').textContent,a:document.querySelector('.exhibition-study-frame img').naturalWidth}");
  if (!opened.open || !opened.status.includes('Operator Atlas') || opened.a !== 96) {
    throw new Error('Full-window study did not open on the accepted selection: ' + JSON.stringify(opened));
  }
  const compared = await execute("document.getElementById('exhibition-study-pin').click(); document.getElementById('exhibition-study-next').click(); return {status:document.getElementById('exhibition-study-status').textContent,images:[...document.querySelectorAll('.exhibition-study-frame:not([hidden]) img')].map(x=>({width:x.naturalWidth,height:x.naturalHeight,src:x.currentSrc})),captions:[...document.querySelectorAll('.exhibition-study-frame:not([hidden]) figcaption')].map(x=>x.textContent)}");
  if (compared.images.length !== 2 || compared.images.some((x) => x.width !== 96 || x.height !== 64 || !x.src.startsWith('blob:')) ||
      !compared.status.includes('Timeline Pulse') || !compared.captions.every((x) => x.includes('decoded RGBA8') && x.includes('recipe '))) {
    throw new Error('Canonical two-up study was invalid: ' + JSON.stringify(compared));
  }
  // Actual selected B native downloads: disk bytes, not merely a click.
  const editorBeforeDirectExport = await execute("return {hash:document.documentElement.dataset.fieldweaverCanonicalRecipeHash,selected:document.getElementById('preset-select').value}");
  const selectedHash = result.tiles.find((tile) => tile.id === 'timeline-pulse').hash;
  const selectedEntry = exhibitionEntries().find((entry) => entry.id === 'timeline-pulse');
  if (!selectedHash || !selectedEntry) throw new Error('Missing accepted selected B identity.');
  // Separate real keyboard gestures: Chrome blocks two automatic downloads
  // from a single synthetic JS task even though owners click these separately.
  const saveByKeyboard = async (id) => {
    const focused = await execute("const button=document.getElementById('" + id + "');button.focus();return document.activeElement===button");
    if (!focused) throw new Error('Study download control is not keyboard focusable: ' + id);
    await request('POST', '/session/' + sessionId + '/actions', {
      actions: [{ type: 'key', id: 'study-export-keyboard', actions: [
        { type: 'keyDown', value: '\uE007' }, { type: 'keyUp', value: '\uE007' }
      ] }]
    });
    await request('DELETE', '/session/' + sessionId + '/actions');
  };
  const readSaved = async (name, validBytes) => {
    // Firefox may expose the destination file before it has finished writing.
    // Wait for a *complete parseable and identity-checked* file, not existence.
    let last = 'not created';
    for (let n = 0; n < 100; n++) {
      try {
        const bytes = await readFile(join(downloadDir, name));
        if (validBytes(bytes)) return bytes;
        last = 'incomplete or invalid (' + bytes.length + ' bytes)';
      } catch (error) { last = error?.message ?? String(error); }
      await sleep(100);
    }
    throw new Error('Browser did not finish verified study download ' + name + ': ' + last);
  };
  const pngName = 'fieldweaver-timeline-pulse-' + selectedHash + '.png';
  const recipeName = 'fieldweaver-timeline-pulse-' + selectedEntry.recipeHash + '.fwrecipe.json';
  await saveByKeyboard('exhibition-study-save-png');
  const pngBytes = await readSaved(pngName, (bytes) => {
    try {
      const decoded = decodePngRgba(new Uint8Array(bytes));
      return decoded.widthPx === 96 && decoded.heightPx === 64 &&
        rawRgbaHash(decoded.rgba) === selectedHash;
    } catch { return false; }
  });
  const savedPng = decodePngRgba(new Uint8Array(pngBytes));
  // The PNG and provenance already refuse a forged gallery proof lease.
  // Recheck that recipe download cannot quietly bypass this boundary just
  // because its immutable accepted recipe hash is otherwise valid.
  const forgedRecipeExport = await execute("const card=document.querySelector('[data-exhibition-id=timeline-pulse]');const original=card.dataset.canonicalRgbaHash;card.dataset.canonicalRgbaHash='0000000000000000';document.getElementById('exhibition-study-save-recipe').click();const status=document.getElementById('exhibition-study-status').textContent;card.dataset.canonicalRgbaHash=original;return status");
  if (!forgedRecipeExport.includes('Recipe export refused: Current verified CPU proof is unavailable or mismatched.')) {
    throw new Error('Recipe download accepted a forged live canonical source: ' + forgedRecipeExport);
  }
  await saveByKeyboard('exhibition-study-save-recipe');
  const recipeBytes = await readSaved(recipeName, (bytes) => {
    try {
      const recipe = parseRecipe(bytes.toString('utf8'));
      return recipeHash(recipe) === selectedEntry.recipeHash && recipe.seed === selectedEntry.seed;
    } catch { return false; }
  });
  const studySavedRecipe = parseRecipe(recipeBytes.toString('utf8'));
  const provenanceName = 'fieldweaver-timeline-pulse-' + selectedHash + '.fwprovenance.json';
  await saveByKeyboard('exhibition-study-save-provenance');
  const provenanceBytes = await readSaved(provenanceName, (bytes) => {
    try {
      const receipt = JSON.parse(bytes.toString('utf8'));
      return receipt.version === 'fw-export-provenance-v1' &&
        receipt.recipeHash === selectedEntry.recipeHash &&
        receipt.seed === selectedEntry.seed &&
        receipt.rawRgbaHash === selectedHash &&
        receipt.targetTick === selectedEntry.targetTick &&
        receipt.crop.widthPx === selectedEntry.exportCrop.widthPx &&
        receipt.crop.heightPx === selectedEntry.exportCrop.heightPx &&
        recipeHash(parseRecipe(JSON.stringify(receipt.recipe))) === selectedEntry.recipeHash;
    } catch { return false; }
  });
  const studySavedProvenance = JSON.parse(provenanceBytes.toString('utf8'));
  const editorAfterDirectExport = await execute("return {hash:document.documentElement.dataset.fieldweaverCanonicalRecipeHash,selected:document.getElementById('preset-select').value,open:document.getElementById('exhibition-study-dialog').open,status:document.getElementById('exhibition-study-status').textContent}");
  if (savedPng.widthPx !== 96 || savedPng.heightPx !== 64 ||
      rawRgbaHash(savedPng.rgba) !== selectedHash ||
      recipeHash(studySavedRecipe) !== selectedEntry.recipeHash ||
      studySavedRecipe.seed !== selectedEntry.seed ||
      editorBeforeDirectExport.hash !== editorAfterDirectExport.hash ||
      editorAfterDirectExport.selected !== 'operator-atlas' ||
      !editorAfterDirectExport.open ||
      !editorAfterDirectExport.status.includes('full canonical provenance for Timeline Pulse') ||
      studySavedProvenance.rawRgbaHash !== selectedHash ||
      studySavedProvenance.targetTick !== selectedEntry.targetTick) {
    throw new Error('Selected B direct export was stale or changed the editor: ' + JSON.stringify(editorAfterDirectExport));
  }
  await writeFile('exhibition-study-selected-export-' + browser + '.json',
    JSON.stringify({browser,pngName,recipeName,provenanceName,forgedRecipeExport,rgbaHash:rawRgbaHash(savedPng.rgba),
      recipeHash:recipeHash(studySavedRecipe),receiptTick:studySavedProvenance.targetTick,
      receiptRawRgbaHash:studySavedProvenance.rawRgbaHash,
      editorBeforeDirectExport,editorAfterDirectExport},null,2)+'\n');
  await request('POST', '/session/' + sessionId + '/window/rect', { width: 1250, height: 900 });
  const studyScreenshot = await request('GET', '/session/' + sessionId + '/screenshot');
  if (!studyScreenshot?.value) throw new Error('Full-window study screenshot absent.');
  await writeFile('exhibition-study-' + browser + '.png', Buffer.from(studyScreenshot.value, 'base64'));
  // Exercise the actual browser's decoded CPU-pixel inspection, not WebGL.
  await execute("document.getElementById('exhibition-study-pixel-toggle').click(); const x=document.getElementById('exhibition-study-pixel-x');const y=document.getElementById('exhibition-study-pixel-y');x.value='3';y.value='7';x.dispatchEvent(new Event('input',{bubbles:true}))");
  let sampled;
  for(let i=0;i<50;i++){
    sampled=await execute("return {text:document.getElementById('exhibition-study-pixel-reading').textContent,ab:document.getElementById('exhibition-study-pixel-ab').textContent,neighbours:document.querySelectorAll('.exhibition-study-pixel-cell').length,centres:document.querySelectorAll('.exhibition-study-pixel-cell.is-centre').length,colour:document.querySelector('.exhibition-study-pixel-cell.is-centre')?.style.backgroundColor,expanded:document.getElementById('exhibition-study-pixel-toggle').getAttribute('aria-expanded')}");
    if(sampled.text.includes('(3, 7)')) break;
    await sleep(100);
  }
  if(!sampled.text.includes('(3, 7)') || !sampled.text.includes('RGBA8') ||
     sampled.neighbours!==81 || sampled.centres!==1 || !sampled.colour || sampled.expanded!=='true') {
    throw new Error('Exact decoded pixel inspection failed: '+JSON.stringify(sampled));
  }
  const comparisonA = decodePngRgba(renderVisualIndexProof('operator-atlas').png).rgba;
  const comparisonB = decodePngRgba(renderVisualIndexProof('timeline-pulse').png).rgba;
  const pixelOffset = (7 * 96 + 3) * 4;
  const expectedDelta = Array.from({ length: 4 }, (_, channel) =>
    comparisonB[pixelOffset + channel] - comparisonA[pixelOffset + channel]).join(', ');
  if (!sampled.ab.includes('A Operator Atlas: ') ||
      !sampled.ab.includes('B Timeline Pulse: ') ||
      !sampled.ab.includes('Δ(B−A) RGBA8 ' + expectedDelta) ||
      !(/same authored crop|IMAGE-LOCAL ONLY/.test(sampled.ab))) {
    throw new Error('Actual A/B source-pixel channel delta is incorrect: ' +
      JSON.stringify({ ab: sampled.ab, expectedDelta }));
  }
  // Save an actual browser-downloaded, source-exact A/B pixel research receipt.
  // It has no invented world alignment and cannot outlive either proof lease.
  const pixelReceiptName = 'fieldweaver-pixel-operator-atlas-vs-timeline-pulse-x3-y7.fwpixel.json';
  await saveByKeyboard('exhibition-study-pixel-save');
  const pixelReceiptBytes = await readSaved(pixelReceiptName, (bytes) => {
    try {
      const receipt = JSON.parse(bytes.toString('utf8'));
      return receipt.version === 'fw-exhibition-pixel-receipt-v1' &&
        receipt.coordinateSpace === 'image-local-top-left' &&
        receipt.coordinate.x === 3 && receipt.coordinate.y === 7 &&
        receipt.a.id === 'operator-atlas' && receipt.b.id === 'timeline-pulse' &&
        receipt.b.rawRgbaHash === selectedHash &&
        receipt.comparison.deltaBMinusA.join(', ') === expectedDelta;
    } catch { return false; }
  });
  const pixelReceipt = JSON.parse(pixelReceiptBytes.toString('utf8'));
  // Invalidating only the *peer* proof must also refuse cached A/B readings.
  await execute("const card=document.querySelector('[data-exhibition-id=operator-atlas]');window.__studyPeerHash=card.dataset.canonicalRgbaHash;card.dataset.canonicalRgbaHash='0000000000000000';document.getElementById('exhibition-study-pixel-x').dispatchEvent(new Event('input',{bubbles:true}))");
  let invalidPeer = '';
  for (let i = 0; i < 30; i++) {
    invalidPeer = await execute("return document.getElementById('exhibition-study-pixel-reading').textContent");
    if (invalidPeer.includes('Cannot inspect this verified PNG:')) break;
    await sleep(100);
  }
  const noStaleDelta = await execute("return {hidden:document.getElementById('exhibition-study-pixel-ab').hidden,text:document.getElementById('exhibition-study-pixel-ab').textContent}");
  if (!invalidPeer.includes('Current verified CPU proof is unavailable or mismatched') ||
      !noStaleDelta.hidden || noStaleDelta.text) {
    throw new Error('Stale peer survived source-exact A/B lease invalidation: ' +
      JSON.stringify({invalidPeer,noStaleDelta}));
  }
  await execute("const card=document.querySelector('[data-exhibition-id=operator-atlas]');card.dataset.canonicalRgbaHash=window.__studyPeerHash;document.getElementById('exhibition-study-pixel-x').dispatchEvent(new Event('input',{bubbles:true}))");
  let peerRestored = '';
  for (let i = 0; i < 30; i++) {
    peerRestored = await execute("return document.getElementById('exhibition-study-pixel-ab').textContent");
    if (peerRestored.includes('Δ(B−A) RGBA8 ' + expectedDelta)) break;
    await sleep(100);
  }
  if (!peerRestored.includes('Δ(B−A) RGBA8 ' + expectedDelta)) {
    throw new Error('A/B peer evidence did not recover after restored registry: ' + peerRestored);
  }
  // Exercise a visibly different accepted source pixel, not only shared
  // background colours. The exact numeric oracle is independently decoded.
  await execute("const x=document.getElementById('exhibition-study-pixel-x');const y=document.getElementById('exhibition-study-pixel-y');x.value='20';y.value='35';x.dispatchEvent(new Event('input',{bubbles:true}))");
  let visibleDifference = '';
  for (let i = 0; i < 30; i++) {
    visibleDifference = await execute("return document.getElementById('exhibition-study-pixel-ab').textContent");
    if (visibleDifference.includes('Δ(B−A) RGBA8 7, 18, 20, 0')) break;
    await sleep(100);
  }
  const visibleOffset = (35 * 96 + 20) * 4;
  const visibleDelta = Array.from({ length: 4 }, (_, channel) =>
    comparisonB[visibleOffset + channel] - comparisonA[visibleOffset + channel]).join(', ');
  if (visibleDelta !== '7, 18, 20, 0' ||
      !visibleDifference.includes('Δ(B−A) RGBA8 ' + visibleDelta) ||
      !visibleDifference.includes('A Operator Atlas: #51ccdb') ||
      !visibleDifference.includes('B Timeline Pulse: #58deef')) {
    throw new Error('Non-background A/B pixel delta was not source exact: ' +
      JSON.stringify({visibleDifference,visibleDelta}));
  }
  // Actual browser action: find the next differing source pixel, not merely
  // check the known nonzero delta at the initial position.
  const expectedNextDifference = (() => {
    const count = 96 * 64, start = 35 * 96 + 20;
    for (let step = 1; step <= count; step += 1) {
      const pos = (start + step) % count, offset = pos * 4;
      if ([0, 1, 2, 3].some(ch => comparisonA[offset + ch] !== comparisonB[offset + ch])) {
        return { x: pos % 96, y: Math.floor(pos / 96),
          delta: Array.from({length: 4}, (_, ch) =>
            comparisonB[offset + ch] - comparisonA[offset + ch]).join(', ') };
      }
    }
    return null;
  })();
  if (!expectedNextDifference || expectedNextDifference.delta === '0, 0, 0, 0') {
    throw new Error('Accepted canonical A/B oracle has no next differing pixel.');
  }
  const differenceEnabled = await execute("return !document.getElementById('exhibition-study-pixel-difference').disabled");
  if (!differenceEnabled) throw new Error('A/B difference navigation disabled despite pinned A and current B.');
  await execute("document.getElementById('exhibition-study-pixel-difference').click()");
  let nextDifference = null;
  for (let i = 0; i < 35; i += 1) {
    nextDifference = await execute("return {text:document.getElementById('exhibition-study-pixel-reading').textContent,ab:document.getElementById('exhibition-study-pixel-ab').textContent,x:Number(document.getElementById('exhibition-study-pixel-x').value),y:Number(document.getElementById('exhibition-study-pixel-y').value)}");
    if (nextDifference.x === expectedNextDifference.x &&
        nextDifference.y === expectedNextDifference.y &&
        nextDifference.ab.includes('Δ(B−A) RGBA8 ' + expectedNextDifference.delta)) break;
    await sleep(100);
  }
  if (nextDifference.x !== expectedNextDifference.x || nextDifference.y !== expectedNextDifference.y ||
      !nextDifference.text.includes('Timeline Pulse') ||
      !nextDifference.ab.includes('Δ(B−A) RGBA8 ' + expectedNextDifference.delta) ||
      !nextDifference.ab.match(/same authored crop|IMAGE-LOCAL ONLY/)) {
    throw new Error('Next A/B difference failed decoded CPU oracle: ' +
      JSON.stringify({nextDifference,expectedNextDifference}));
  }
  const differenceShot = await request('GET', '/session/' + sessionId + '/screenshot');
  if (!differenceShot?.value) throw new Error('Exact A/B difference screenshot unavailable.');
  await writeFile('exhibition-pixel-difference-' + browser + '.png',
    Buffer.from(differenceShot.value, 'base64'));
  // Real keyboard backward action returns to the exact previous source pixel.
  await saveByKeyboard('exhibition-study-pixel-difference-prev');
  let previousDifference = null;
  for (let i = 0; i < 35; i += 1) {
    previousDifference = await execute("return {x:Number(document.getElementById('exhibition-study-pixel-x').value),y:Number(document.getElementById('exhibition-study-pixel-y').value),ab:document.getElementById('exhibition-study-pixel-ab').textContent}");
    if (previousDifference.x === 20 && previousDifference.y === 35 &&
        previousDifference.ab.includes('Δ(B−A) RGBA8 7, 18, 20, 0')) break;
    await sleep(100);
  }
  if (previousDifference.x !== 20 || previousDifference.y !== 35 ||
      !previousDifference.ab.includes('Δ(B−A) RGBA8 7, 18, 20, 0')) {
    throw new Error('Keyboard previous A/B difference failed canonical round-trip: ' +
      JSON.stringify(previousDifference));
  }
  await saveByKeyboard('exhibition-study-pixel-difference');
  let forwardAgain = null;
  for (let i = 0; i < 35; i += 1) {
    forwardAgain = await execute("return {x:Number(document.getElementById('exhibition-study-pixel-x').value),y:Number(document.getElementById('exhibition-study-pixel-y').value),ab:document.getElementById('exhibition-study-pixel-ab').textContent}");
    if (forwardAgain.x === expectedNextDifference.x && forwardAgain.y === expectedNextDifference.y &&
        forwardAgain.ab.includes('Δ(B−A) RGBA8 ' + expectedNextDifference.delta)) break;
    await sleep(100);
  }
  if (forwardAgain.x !== expectedNextDifference.x ||
      forwardAgain.y !== expectedNextDifference.y ||
      !forwardAgain.ab.includes('Δ(B−A) RGBA8 ' + expectedNextDifference.delta)) {
    throw new Error('Keyboard A/B forward recovery failed decoded CPU oracle: ' + JSON.stringify(forwardAgain));
  }
  // The summary is an independent full-overlap decoded-CPU measurement.
  const expectedSummaryCount = (() => {
    let count = 0;
    for (let pixel = 0; pixel < comparisonA.length; pixel += 4) {
      if ([0, 1, 2, 3].some(ch => comparisonA[pixel + ch] !== comparisonB[pixel + ch])) count += 1;
    }
    return count;
  })();
  await saveByKeyboard('exhibition-study-pixel-summary');
  const overlapSummary = await execute("return {text:document.getElementById('exhibition-study-pixel-summary-reading').textContent,hidden:document.getElementById('exhibition-study-pixel-summary-reading').hidden}");
  if (overlapSummary.hidden ||
      !overlapSummary.text.includes('differing pixels ' + expectedSummaryCount + '/6144') ||
      !overlapSummary.text.includes('maximum |Δ(B−A)| RGBA8')) {
    throw new Error('A/B summary did not match independent canonical PNG byte oracle: ' +
      JSON.stringify({overlapSummary,expectedSummaryCount}));
  }
  const summaryShot = await request('GET', '/session/' + sessionId + '/screenshot');
  if (!summaryShot?.value) throw new Error('A/B summary screenshot unavailable.');
  await writeFile('exhibition-pixel-summary-' + browser + '.png',
    Buffer.from(summaryShot.value, 'base64'));
  await writeFile('exhibition-pixel-summary-' + browser + '.json',
    JSON.stringify({ browser, expectedDifferentPixels: expectedSummaryCount,
      overlapPixels: 6144, observed: overlapSummary }, null, 2) + '\n');
  const forgedSummary = await execute("const card=document.querySelector('[data-exhibition-id=operator-atlas]');const old=card.dataset.canonicalRgbaHash;card.dataset.canonicalRgbaHash='0000000000000000';document.getElementById('exhibition-study-pixel-summary').click();const result={summary:document.getElementById('exhibition-study-pixel-summary-reading').textContent,reading:document.getElementById('exhibition-study-pixel-reading').textContent,abHidden:document.getElementById('exhibition-study-pixel-ab').hidden,ab:document.getElementById('exhibition-study-pixel-ab').textContent};card.dataset.canonicalRgbaHash=old;return result");
  if (!forgedSummary.summary.startsWith('A/B summary refused:') ||
      forgedSummary.summary.includes('differing pixels ' + expectedSummaryCount) ||
      !forgedSummary.reading.startsWith('Cannot inspect verified A/B images:') ||
      !forgedSummary.abHidden || forgedSummary.ab) {
    throw new Error('A/B summary retained stale pixel or statistics with a forged proof: ' +
      JSON.stringify(forgedSummary));
  }
  // The new traversal must refuse a forged peer even if previously cached.
  const forgedDifference = await execute("const card=document.querySelector('[data-exhibition-id=operator-atlas]');const previous=card.dataset.canonicalRgbaHash;card.dataset.canonicalRgbaHash='0000000000000000';document.getElementById('exhibition-study-pixel-difference').click();const evidence={reading:document.getElementById('exhibition-study-pixel-reading').textContent,abHidden:document.getElementById('exhibition-study-pixel-ab').hidden,ab:document.getElementById('exhibition-study-pixel-ab').textContent};card.dataset.canonicalRgbaHash=previous;return evidence");
  if (!forgedDifference.reading.includes('Cannot inspect verified A/B images:') ||
      !forgedDifference.reading.includes('Current verified CPU proof is unavailable or mismatched') ||
      !forgedDifference.abHidden || forgedDifference.ab) {
    throw new Error('Next-difference traversal retained a forged A/B proof: ' +
      JSON.stringify(forgedDifference));
  }
  // Restore the previous source coordinate for cache-forgery and recovery gates.
  await execute("const x=document.getElementById('exhibition-study-pixel-x');const y=document.getElementById('exhibition-study-pixel-y');x.value='3';y.value='7';x.dispatchEvent(new Event('input',{bubbles:true}))");
  // Cached pixel reads must revalidate current registry custody, not trust
  // a previously decoded PNG after a changed DOM identity.
  await execute("const card=document.querySelector('[data-exhibition-id=timeline-pulse]');window.__originalStudyHash=card.dataset.canonicalRgbaHash;card.dataset.canonicalRgbaHash='0000000000000000';document.getElementById('exhibition-study-pixel-x').dispatchEvent(new Event('input',{bubbles:true}))");
  let forgedPixel = '';
  for (let i = 0; i < 30; i++) {
    forgedPixel = await execute("return document.getElementById('exhibition-study-pixel-reading').textContent");
    if (forgedPixel.includes('Cannot inspect this verified PNG:')) break;
    await sleep(100);
  }
  if (!forgedPixel.includes('Current verified CPU proof is unavailable or mismatched')) {
    throw new Error('Stale cached canonical pixel escaped forged hash check: ' + forgedPixel);
  }
  await execute("const card=document.querySelector('[data-exhibition-id=timeline-pulse]');card.dataset.canonicalRgbaHash=window.__originalStudyHash;document.getElementById('exhibition-study-pixel-x').dispatchEvent(new Event('input',{bubbles:true}))");
  let restoredPixel = '';
  for (let i = 0; i < 30; i++) {
    restoredPixel = await execute("return document.getElementById('exhibition-study-pixel-reading').textContent");
    if (restoredPixel.includes('Timeline Pulse · (3, 7)') && restoredPixel.includes('image identity ' + selectedHash)) break;
    await sleep(100);
  }
  if (!restoredPixel.includes('Timeline Pulse · (3, 7)') ||
      !restoredPixel.includes('image identity ' + selectedHash)) {
    throw new Error('Canonical pixel did not recover after restored hash: ' + restoredPixel);
  }
  await execute("const select=document.getElementById('exhibition-study-pixel-source');select.value='A';select.dispatchEvent(new Event('change',{bubbles:true}))");
  let aPixel='';
  for(let i=0;i<50;i++){
    aPixel=await execute("return document.getElementById('exhibition-study-pixel-reading').textContent");
    if(aPixel.includes('Operator Atlas') && aPixel.includes('RGBA8')) break;
    await sleep(100);
  }
  if(!aPixel.includes('Operator Atlas') || !aPixel.includes('RGBA8') ||
     !sampled.text.includes('Timeline Pulse')) {
    throw new Error('Independent A/B pixel inspection failed: '+JSON.stringify({aPixel,sampled}));
  }
  // Use a real decoded non-background mark for the archived visual sample.
  await execute("document.getElementById('exhibition-study-pixel-next').click()");
  let marked = '';
  for (let i = 0; i < 45; i += 1) {
    marked = await execute("return document.getElementById('exhibition-study-pixel-reading').textContent");
    if (marked.includes('RGBA8') && !marked.includes('#090b08')) break;
    await sleep(100);
  }
  if (!marked.includes('Operator Atlas') || marked.includes('#090b08')) {
    throw new Error('Cannot inspect a visible canonical painted pixel: ' + marked);
  }
  const pixelShot=await request('GET','/session/'+sessionId+'/screenshot');
  if(!pixelShot?.value) throw new Error('Decoded pixel screenshot not captured');
  await writeFile('exhibition-pixels-'+browser+'.png',Buffer.from(pixelShot.value,'base64'));
  await writeFile('exhibition-pixels-'+browser+'.json',JSON.stringify({browser,sampled,expectedDelta,visibleDifference,expectedNextDifference,nextDifference,previousDifference,forwardAgain,forgedDifference,invalidPeer,noStaleDelta,peerRestored,forgedPixel,restoredPixel,aPixel,marked},null,2)+'\n');
  // Real WebDriver key actions on focused canonical images; distinguish from
  // gallery Left/Right while retaining source-specific A/B coordinates.
  const pressPixelKey = async (value, shifted = false) => {
    const keys = shifted
      ? [{ type: 'keyDown', value: '\uE008' }, { type: 'keyDown', value },
         { type: 'keyUp', value }, { type: 'keyUp', value: '\uE008' }]
      : [{ type: 'keyDown', value }, { type: 'keyUp', value }];
    await request('POST', '/session/' + sessionId + '/actions', {
      actions: [{ type: 'key', id: 'pixel-keyboard', actions: keys }]
    });
    await request('DELETE', '/session/' + sessionId + '/actions');
  };
  await execute("const x=document.getElementById('exhibition-study-pixel-x');const y=document.getElementById('exhibition-study-pixel-y');x.value='10';y.value='10';x.dispatchEvent(new Event('input',{bubbles:true}));document.querySelectorAll('.exhibition-study-frame img')[0].focus()");
  await pressPixelKey('\uE014'); // ArrowRight on focused A image
  const pixelRight = await execute("return {text:document.getElementById('exhibition-study-pixel-reading').textContent,status:document.getElementById('exhibition-study-status').textContent,source:document.getElementById('exhibition-study-pixel-source').value,focus:document.activeElement.tagName}");
  if (!pixelRight.text.includes('Operator Atlas · (11, 10)') || !pixelRight.status.includes('Timeline Pulse') ||
      pixelRight.source !== 'A' || pixelRight.focus !== 'IMG') {
    throw new Error('Keyboard source-pixel right movement failed: ' + JSON.stringify(pixelRight));
  }
  await pressPixelKey('\uE015', true); // Shift+ArrowDown: ten source rows
  const pixelDown = await execute("return document.getElementById('exhibition-study-pixel-reading').textContent");
  if (!pixelDown.includes('Operator Atlas · (11, 20)')) {
    throw new Error('Coarse keyboard source-pixel movement failed: ' + pixelDown);
  }
  await execute("document.querySelectorAll('.exhibition-study-frame img')[1].focus()");
  await pressPixelKey('\uE007'); // Enter: centre the other canonical image
  const pixelB = await execute("return {text:document.getElementById('exhibition-study-pixel-reading').textContent,source:document.getElementById('exhibition-study-pixel-source').value}");
  if (!pixelB.text.includes('Timeline Pulse · (48, 32)') || pixelB.source !== 'B') {
    throw new Error('Focused B image did not independently sample source centre: ' + JSON.stringify(pixelB));
  }
  await pressPixelKey('\uE012'); // ArrowLeft on B must not navigate gallery
  const pixelBLeft = await execute("return {text:document.getElementById('exhibition-study-pixel-reading').textContent,status:document.getElementById('exhibition-study-status').textContent}");
  if (!pixelBLeft.text.includes('Timeline Pulse · (47, 32)') ||
      !pixelBLeft.status.includes('Timeline Pulse')) {
    throw new Error('B pixel movement navigated gallery or lost the verified image: ' + JSON.stringify(pixelBLeft));
  }
  await request('POST', '/session/' + sessionId + '/window/rect', { width: 390, height: 844 });
  const narrow = await execute("const r=document.getElementById('exhibition-study-dialog').getBoundingClientRect();const q=document.getElementById('exhibition-study-pixel-reading').getBoundingClientRect();return {width:innerWidth,height:innerHeight,dialogLeft:r.left,dialogRight:r.right,readingTop:q.top,readingBottom:q.bottom,scrollW:document.getElementById('exhibition-study-dialog').scrollWidth,clientW:document.getElementById('exhibition-study-dialog').clientWidth,selected:document.getElementById('exhibition-study-pixel-reading').textContent,focused:document.activeElement.tagName}");
  if (narrow.width > 550 || narrow.dialogLeft < -1 || narrow.dialogRight > narrow.width + 1 ||
      narrow.readingTop < 0 || narrow.readingBottom > narrow.height + 1 ||
      !narrow.selected.includes('Timeline Pulse · (47, 32)') || narrow.focused !== 'IMG') {
    throw new Error('Narrow keyboard inspection failed: ' + JSON.stringify(narrow));
  }
  const narrowShot = await request('GET', '/session/' + sessionId + '/screenshot');
  if (!narrowShot?.value) throw new Error('Narrow keyboard inspection screenshot absent.');
  await writeFile('exhibition-pixel-keyboard-' + browser + '.png', Buffer.from(narrowShot.value, 'base64'));
  await writeFile('exhibition-pixel-keyboard-' + browser + '.json',
    JSON.stringify({ browser, pixelRight, pixelDown, pixelB, pixelBLeft, narrow }, null, 2) + '\n');
  await request('POST', '/session/' + sessionId + '/window/rect', { width: 1250, height: 900 });
  // Check a forged A after keyboard/narrow assertions but before re-pinning;
  // the receipt still compares Operator Atlas (A) against Timeline Pulse (B).
  const forgedPixelReceipt = await execute("const card=document.querySelector('[data-exhibition-id=operator-atlas]');const old=card.dataset.canonicalRgbaHash;card.dataset.canonicalRgbaHash='0000000000000000';document.getElementById('exhibition-study-pixel-save').click();const msg=document.getElementById('exhibition-study-status').textContent;card.dataset.canonicalRgbaHash=old;return msg");
  if (!forgedPixelReceipt.includes('Pixel receipt refused: Current verified CPU proof is unavailable or mismatched')) {
    throw new Error('Forged A source was allowed to export an A/B pixel receipt: ' + forgedPixelReceipt);
  }
  await writeFile('exhibition-pixel-receipt-' + browser + '.json',
    JSON.stringify({browser,pixelReceiptName,pixelReceipt,forgedPixelReceipt},null,2) + '\n');
  // Keyboard P re-pins the current B artwork as A. The visible pixel reading
  // must switch from the old A PNG identity to the current accepted CPU proof.
  await execute("const pick=document.getElementById('exhibition-study-pixel-source');pick.value='A';pick.dispatchEvent(new Event('change',{bubbles:true}));document.querySelectorAll('.exhibition-study-frame img')[0].focus()");
  let beforeRepin = '';
  for (let i = 0; i < 35; i += 1) {
    beforeRepin = await execute("return document.getElementById('exhibition-study-pixel-reading').textContent");
    if (beforeRepin.includes('Operator Atlas · (48, 32)')) break;
    await sleep(100);
  }
  if (!beforeRepin.includes('Operator Atlas · (48, 32)')) {
    throw new Error('Old A canonical pixel was not bound before keyboard re-pin: ' + beforeRepin);
  }
  await pressPixelKey('p');
  let repin;
  for (let i = 0; i < 35; i += 1) {
    repin = await execute("return {reading:document.getElementById('exhibition-study-pixel-reading').textContent,status:document.getElementById('exhibition-study-status').textContent,source:document.getElementById('exhibition-study-pixel-source').value,open:document.getElementById('exhibition-study-dialog').open}");
    if (repin.reading.includes('Timeline Pulse · (48, 32)')) break;
    await sleep(100);
  }
  const timelineHash = result.tiles.find((tile) => tile.id === 'timeline-pulse').hash;
  if (!repin?.reading.includes('Timeline Pulse · (48, 32)') ||
      !repin.reading.includes('image identity ' + timelineHash) ||
      repin.reading.includes('Operator Atlas') || repin.source !== 'A' ||
      !repin.status.includes('A pinned: Timeline Pulse') || !repin.open) {
    throw new Error('Keyboard re-pin left stale A canonical source bytes or readout: ' + JSON.stringify(repin));
  }
  // Complete browse -> A/B -> source-pixel inspection -> offline export from
  // the same modal. Capture the real HTML Blob without fetch(blob:), which CSP
  // intentionally denies; the accepted board exporter remains authoritative.
  await execute("window.__studyBoardHtml=null;const native=URL.createObjectURL;URL.createObjectURL=function(blob){if(blob.type.startsWith('text/html'))blob.text().then(value=>{window.__studyBoardHtml=value});return native.call(this,blob)};document.getElementById('exhibition-study-save-board').click();URL.createObjectURL=native");
  let boardHtml = null;
  for (let i = 0; i < 40; i += 1) {
    boardHtml = await execute("return window.__studyBoardHtml");
    if (boardHtml) break;
    await sleep(100);
  }
  const boardResult = await execute("return {dialogOpen:document.getElementById('exhibition-study-dialog').open,status:document.getElementById('exhibition-study-status').textContent,source:document.getElementById('exhibition-study-pixel-reading').textContent,editor:document.getElementById('preset-status').textContent}");
  if (!boardHtml || !boardResult.dialogOpen ||
      !boardResult.status.includes('Offline canonical board download requested: 4 accepted proofs') ||
      !boardResult.source.includes('Timeline Pulse · (48, 32)') ||
      (boardHtml.match(/<article id="work-/g) ?? []).length !== 4 ||
      (boardHtml.match(/src="data:image\/png;base64,/g) ?? []).length !== 4 ||
      !boardHtml.includes('default-src &#39;none&#39;') ||
      /UNMERGED CANDIDATE/i.test(boardHtml) ||
      result.tiles.some((tile) => !boardHtml.includes(tile.hash))) {
    throw new Error('Study board export changed source pixels or used unsupported artwork: ' +
      JSON.stringify({ boardResult, htmlLength: boardHtml?.length, hasCsp: boardHtml?.includes('default-src &#39;none&#39;') }));
  }
  const exportShot = await request('GET', '/session/' + sessionId + '/screenshot');
  if (!exportShot?.value) throw new Error('Study export screenshot absent.');
  await writeFile('exhibition-study-export-' + browser + '.png', Buffer.from(exportShot.value, 'base64'));
  await writeFile('exhibition-study-export-' + browser + '.json',
    JSON.stringify({ browser, beforeRepin, repin, boardResult,
      boardHtmlBytes: new TextEncoder().encode(boardHtml).length,
      acceptedHashes: result.tiles.map((tile) => tile.hash) }, null, 2) + '\n');
  const keyboard = await execute("const dialog=document.getElementById('exhibition-study-dialog');dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));const back=document.getElementById('exhibition-study-status').textContent;dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));return {back,forward:document.getElementById('exhibition-study-status').textContent}");
  if (!keyboard.back.includes('Operator Atlas') || !keyboard.forward.includes('Timeline Pulse')) {
    throw new Error('Study keyboard navigation failed: ' + JSON.stringify(keyboard));
  }
  const loaded = await execute("document.getElementById('exhibition-study-load').click();return {dialogOpen:document.getElementById('exhibition-study-dialog').open,selected:document.getElementById('preset-select').value,status:document.getElementById('preset-status').textContent}");
  if (loaded.dialogOpen || loaded.selected !== 'timeline-pulse' || !loaded.status.startsWith('Loaded Timeline Pulse')) {
    throw new Error('Study did not invoke explicit recipe adoption: ' + JSON.stringify(loaded));
  }
  await writeFile('exhibition-study-' + browser + '.json',
    JSON.stringify({ browser, opened, compared, keyboard, loaded }, null, 2) + '\n');
  await request('POST', '/session/' + sessionId + '/window/rect', { width: 1250, height: 900 });
  await execute("document.querySelector('#exhibition-grid').scrollIntoView({block:'center'})");
  const screenshot = await request('GET', '/session/' + sessionId + '/screenshot');
  if (!screenshot?.value) throw new Error('Browser screenshot absent.');
  await writeFile('exhibition-visual-index-' + browser + '.png', Buffer.from(screenshot.value, 'base64'));
  await writeFile('exhibition-visual-index-' + browser + '.json', JSON.stringify({ browser, initial, result, selected }, null, 2) + '\n');

  // Export is not complete until the same authored HTML opens as a genuine
  // file:// document. The existing gallery-review test covers two different
  // accepted records; here we check all four from the study export itself.
  // This verifies offline rendering, not OS download-manager persistence.
  const offlineName = 'exhibition-accepted-offline-' + browser + '.html';
  await writeFile(offlineName, boardHtml, 'utf8');
  const encoded = [...boardHtml.matchAll(/<article id="work-([^"]+)"[\s\S]*?src="data:image\/png;base64,([^"]+)"/g)];
  if (encoded.length !== result.tiles.length) {
    throw new Error('Offline export did not embed one canonical PNG per accepted work.');
  }
  const offlineDecoded = encoded.map((match) => {
    const id = match[1];
    const pixels = decodePngRgba(new Uint8Array(Buffer.from(match[2], 'base64')));
    const hash = rawRgbaHash(pixels.rgba);
    const accepted = result.tiles.find((tile) => tile.id === id);
    if (!accepted || hash !== accepted.hash || pixels.widthPx !== 96 || pixels.heightPx !== 64) {
      throw new Error('Exported file has mismatched canonical decoded pixels: ' + id + ' / ' + hash);
    }
    return { id, hash, width: pixels.widthPx, height: pixels.heightPx };
  });
  await request('POST', '/session/' + sessionId + '/url',
    { url: pathToFileURL(resolve(offlineName)).href });
  let offlineImages = [];
  for (let i = 0; i < 100; i += 1) {
    offlineImages = await execute("return [...document.querySelectorAll('.work figure img')].map(img=>({complete:img.complete,width:img.naturalWidth,height:img.naturalHeight,src:img.currentSrc}))");
    if (offlineImages.length === 4 && offlineImages.every((img) =>
      img.complete && img.width === 96 && img.height === 64 &&
      img.src.startsWith('data:image/png;base64,'))) break;
    await sleep(100); // Firefox file: decode is asynchronous after navigation.
  }
  if (offlineImages.length !== 4 || offlineImages.some((img) =>
    !img.complete || img.width !== 96 || img.height !== 64 ||
    !img.src.startsWith('data:image/png;base64,'))) {
    throw new Error('Exported HTML did not display genuine embedded PNGs offline: ' +
      JSON.stringify(offlineImages.map(({ complete, width, height, src }) =>
        ({ complete, width, height, isInline:src.startsWith('data:image/png;base64,') }))));
  }
  const offlinePage = await execute("return {title:document.title,heading:document.querySelector('h1')?.textContent,csp:document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]')?.content,articleIds:[...document.querySelectorAll('main article.work')].map(x=>x.id),anchors:[...document.querySelectorAll('nav a')].map(x=>x.getAttribute('href')),scriptCount:document.scripts.length,externalResources:[...document.querySelectorAll('[src],[href]')].map(x=>x.getAttribute('src')||x.getAttribute('href')).filter(x=>/^(https?:|\\/\\/)/i.test(x)),bodyText:document.body.innerText}");
  if (offlinePage.heading !== 'Accepted canonical proofs' ||
      !offlinePage.csp?.includes("default-src 'none'") ||
      !offlinePage.csp.includes("connect-src 'none'") ||
      offlinePage.articleIds.length !== 4 || offlinePage.anchors.length !== 5 ||
      offlinePage.anchors.filter((anchor) => anchor.startsWith('#work-')).length !== 4 ||
      !offlinePage.anchors.includes('#comparison-index') ||
      offlinePage.anchors.some((anchor) => anchor !== '#comparison-index' &&
        !offlinePage.articleIds.includes(anchor.slice(1))) ||
      offlinePage.scriptCount !== 0 || offlinePage.externalResources.length !== 0 ||
      encoded.some((match) => !offlinePage.articleIds.includes('work-' + match[1]) ||
        !offlinePage.bodyText.includes(offlineDecoded.find((p) => p.id === match[1]).hash)) ||
      /UNMERGED CANDIDATE/i.test(offlinePage.bodyText)) {
    throw new Error('Reopened offline exhibition changed acceptance, CSP or proof details: ' +
      JSON.stringify({ heading:offlinePage.heading, csp:offlinePage.csp,
        ids:offlinePage.articleIds, anchors:offlinePage.anchors,
        scripts:offlinePage.scriptCount, remote:offlinePage.externalResources }));
  }
  // Exercise data: download payloads in the real reopened offline document
  // without fetch(blob:) / fetch(data:), both forbidden by the strict CSP.
  // File-manager persistence remains a separate physical owner gate.
  const offlineDownloads = await execute(`return [...document.querySelectorAll('main article.work')].map(article => {
    const provenance = article.querySelector('details pre')?.textContent;
    const record = JSON.parse(provenance);
    const links = [...article.querySelectorAll('.work-actions a')];
    return {
      id: article.id.replace(/^work-/, ''),
      links: links.map(link => {
        const uri = link.getAttribute('href') || '';
        const pngPrefix = 'data:image/png;base64,';
        if (uri.startsWith(pngPrefix)) {
          const bytes = Uint8Array.from(atob(uri.slice(pngPrefix.length)), char => char.charCodeAt(0));
          return { valid: true, isPng: true, download: link.download,
            matchesSource: uri === article.querySelector('figure img')?.getAttribute('src'),
            length: bytes.length };
        }
        const zipPrefix = 'data:application/zip;base64,';
        if (uri.startsWith(zipPrefix)) {
          const bytes = Uint8Array.from(atob(uri.slice(zipPrefix.length)), char => char.charCodeAt(0));
          return { valid: bytes.length > 22 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
            bytes[2] === 3 && bytes[3] === 4,
            isZip: true, download: link.download,
            matchesSource: link.download.includes(article.id.replace(/^work-/, '')) &&
              link.textContent.includes('complete work bundle'),
            length: bytes.length };
        }
        const prefix = 'data:application/json;base64,';
        if (!uri.startsWith(prefix)) return { valid: false };
        const bytes = Uint8Array.from(atob(uri.slice(prefix.length)), char => char.charCodeAt(0));
        const data = new TextDecoder().decode(bytes);
        const parsed = JSON.parse(data);
        return { valid: true, download: link.download, isRecipe: link.textContent.includes('importable recipe'),
          matchesSource: link.textContent.includes('importable recipe')
            ? JSON.stringify(parsed) === JSON.stringify(record.recipe) : data === provenance,
          seed: link.textContent.includes('importable recipe') ? parsed.seed : parsed.seed,
          length: bytes.length };
      })
    };
  })`);
  if (offlineDownloads.length !== 4 || offlineDownloads.some((record) => {
    const canonical = offlineDecoded.find((item) => item.id === record.id);
    return !canonical || record.links.length !== 4 ||
      record.links.some((link) => !link.valid || !link.matchesSource || link.length < 16) ||
      !record.links[0].isRecipe || record.links[1].isRecipe ||
      record.links[0].isPng || record.links[1].isPng || !record.links[2].isPng ||
      !record.links[3].isZip || !record.links[3].download.endsWith('.fwpack.zip') ||
      !record.links[0].download.includes(record.id) ||
      !record.links[1].download.includes(canonical.hash) ||
      !record.links[2].download.includes(record.id) ||
      !record.links[2].download.includes(canonical.hash) ||
      !record.links[3].download.includes(canonical.hash);
  })) {
    throw new Error('Offline accepted recipe/provenance/PNG/ZIP downloads are invalid: ' + JSON.stringify(offlineDownloads));
  }
  const downloadFocus = await execute("const link=document.querySelector('.work-actions a');link.focus();return document.activeElement===link");
  if (!downloadFocus) throw new Error('Offline accepted recipe download is not keyboard focusable.');
  const offlineScreenshot = await request('GET','/session/' + sessionId + '/screenshot');
  if (!offlineScreenshot?.value) throw new Error('Offline board desktop screenshot absent.');
  await writeFile('exhibition-accepted-offline-' + browser + '.png',
    Buffer.from(offlineScreenshot.value,'base64'));
  await request('POST', '/session/' + sessionId + '/window/rect', { width:390, height:844 });
  const navFocus = await execute("document.querySelector('nav a[href=\"#work-operator-atlas\"]').focus();return document.activeElement.getAttribute('href')");
  if (navFocus !== '#work-operator-atlas') throw new Error('Offline navigation link could not receive keyboard focus.');
  await pressPixelKey('\uE007'); // Browser may transfer focus to the anchor target.
  const offlineNarrow = await execute("return {hash:location.hash,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,articleCount:document.querySelectorAll('main article.work').length}");
  if (offlineNarrow.hash !== '#work-operator-atlas' ||
      offlineNarrow.width > (browser === 'chrome' ? 390 : 500) ||
      offlineNarrow.scrollWidth > offlineNarrow.width + 1 ||
      offlineNarrow.articleCount !== 4) {
    throw new Error('Offline keyboard navigation or narrow layout failed: ' +
      JSON.stringify(offlineNarrow));
  }
  const offlineNarrowScreenshot = await request('GET','/session/' + sessionId + '/screenshot');
  if (!offlineNarrowScreenshot?.value) throw new Error('Offline board narrow screenshot absent.');
  await writeFile('exhibition-accepted-offline-narrow-' + browser + '.png',
    Buffer.from(offlineNarrowScreenshot.value,'base64'));
  // Actual browser keyboard activation of static data: download anchors.
  // Reading a href is insufficient: CSP and browser download policies must
  // permit a file to reach disk before the editor can re-import its bytes.
  const embeddedDownloads = [...boardHtml.matchAll(/<a download="([^"]+)" href="data:application\/json;base64,([^"]+)"/g)]
    .map((match) => ({ name: match[1], bytes: Buffer.from(match[2], 'base64') }));
  if (embeddedDownloads.length !== 8) {
    throw new Error('Expected eight independent accepted JSON downloads.');
  }
  const pngDownloads = [...boardHtml.matchAll(/<a download="([^"]+\.canonical\.png)" href="data:image\/png;base64,([^"]+)">Save canonical PNG<\/a>/g)]
    .map((match) => ({ name: match[1], bytes: Buffer.from(match[2], 'base64') }));
  if (pngDownloads.length !== 4) throw new Error('Expected four accepted canonical PNG downloads.');
  const zipDownloads = [...boardHtml.matchAll(/<a download="([^"]+\.fwpack\.zip)" href="data:application\/zip;base64,([^"]+)">Save complete work bundle \(ZIP\)<\/a>/g)]
    .map((match) => ({ name: match[1], bytes: Buffer.from(match[2], 'base64') }));
  if (zipDownloads.length !== 4) throw new Error('Expected four portable accepted work ZIP bundles.');
  const downloadTargets = [embeddedDownloads[0], embeddedDownloads[1], pngDownloads[0], zipDownloads[0]];
  const savedDownloads = [];
  for (const [index, expected] of downloadTargets.entries()) {
    const destination = join(downloadDir, expected.name);
    const focused = await execute("const a=document.querySelectorAll('main article.work')[0].querySelectorAll('.work-actions a')[" + index + "];a.focus();return {active:document.activeElement===a,name:a.download}");
    if (!focused.active || focused.name !== expected.name) {
      throw new Error('Offline recipe/provenance/PNG/ZIP link cannot be activated by keyboard: ' + JSON.stringify(focused));
    }
    await pressPixelKey('\uE007'); // Real WebDriver Enter; no synthetic click or CSP fetch.
    let contents = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { contents = await readFile(destination); } catch { /* download not complete */ }
      if (contents?.equals(expected.bytes)) break;
      await sleep(100);
    }
    if (!contents?.equals(expected.bytes)) {
      throw new Error('Actual offline browser download missing or mismatched: ' + expected.name +
        ' (observed ' + (contents?.length ?? 'none') + ' of ' + expected.bytes.length + ' bytes)');
    }
    savedDownloads.push({ name: expected.name, bytes: contents.length, match: true });
  }
  const savedPngBytes = await readFile(join(downloadDir, pngDownloads[0].name));
  if (rawRgbaHash(decodePngRgba(new Uint8Array(savedPngBytes)).rgba) !== offlineDecoded[0].hash) {
    throw new Error('Actual saved offline PNG does not match the accepted canonical RGBA8 identity.');
  }
  // Reopen the real workbench and import the file that the browser actually
  // saved, rather than regenerating or injecting the recipe JSON from Node.
  const savedRecipePath = join(downloadDir, embeddedDownloads[0].name);
  const savedRecipe = await readFile(savedRecipePath, 'utf8');
  const acceptedRecipeHash = recipeHash(parseRecipe(savedRecipe));
  const firstAccepted = exhibitionEntries().find((entry) => entry.id === offlineDownloads[0].id);
  if (acceptedRecipeHash !== firstAccepted?.recipeHash || !embeddedDownloads[0].name.includes(acceptedRecipeHash)) {
    throw new Error('Saved recipe has an unexpected accepted recipe hash: ' + acceptedRecipeHash);
  }
  await request('POST', '/session/' + sessionId + '/url', { url: 'http://127.0.0.1:4173/' });
  let fileReady = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    fileReady = await execute("return Boolean(document.querySelector('#recipe-file') && document.querySelector('#recipe-status') && document.querySelector('.preset-panel'))");
    if (fileReady) break;
    await sleep(100);
  }
  if (!fileReady) throw new Error('Recipe persistence panel was not available for actual saved-file import.');
  await execute("const f=document.getElementById('recipe-file');f.hidden=false;f.style.display='block'");
  const located = await request('POST', '/session/' + sessionId + '/element',
    { using: 'css selector', value: '#recipe-file' });
  const fileElement = located.value?.['element-6066-11e4-a52e-4f735466cecf'];
  if (!fileElement) throw new Error('Cannot locate real recipe file input for WebDriver upload.');
  await request('POST', '/session/' + sessionId + '/element/' + fileElement + '/value',
    { text: savedRecipePath });
  let imported = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    imported = await execute("return {status:document.getElementById('recipe-status').textContent,hash:document.documentElement.dataset.fieldweaverCanonicalRecipeHash,commands:document.documentElement.dataset.fieldweaverRecipeCommands,proof:document.documentElement.dataset.fieldweaverExhibitionProofHash||''}");
    if (imported.status.startsWith('Loaded ') || imported.status.startsWith('Load rejected')) break;
    await sleep(100);
  }
  if (imported?.status !== 'Loaded ' + acceptedRecipeHash || imported.hash !== acceptedRecipeHash || imported.proof) {
    throw new Error('Downloaded accepted recipe did not re-import into the real editor: ' + JSON.stringify(imported));
  }
  const importScreenshot = await request('GET', '/session/' + sessionId + '/screenshot');
  if (!importScreenshot?.value) throw new Error('Saved-file recipe import screenshot absent.');
  await writeFile('exhibition-offline-reimport-' + browser + '.png',
    Buffer.from(importScreenshot.value, 'base64'));
  await writeFile('exhibition-offline-reimport-' + browser + '.json',
    JSON.stringify({ browser, savedDownloads, acceptedRecipeHash, imported,
      source: 'Real file:// keyboard downloads followed by saved-file input re-import' }, null, 2) + '\n');
  await writeFile('exhibition-accepted-offline-' + browser + '.json',
    JSON.stringify({ browser, source:'existing study export HTML Blob; Node decoded RGBA8 independently',
      offlineDecoded, offlineDownloads, verifiedFromFileUrl:true, offlineNarrow,
      title:offlinePage.title, csp:offlinePage.csp },null,2) + '\n');

  console.log(JSON.stringify({ browser, status:'four actual decoded canonical CPU images', hashes:result.tiles.map((tile) => tile.hash), selected:selected.id }, null, 2));
} finally {
  if (sessionId) { try { await request('DELETE', '/session/' + sessionId); } catch { /* cleanup */ } }
  driver.kill('SIGTERM');
}
