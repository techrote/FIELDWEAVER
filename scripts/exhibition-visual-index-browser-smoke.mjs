import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const browser = process.argv[2] ?? 'firefox';
if (!['chrome', 'firefox'].includes(browser)) throw new Error('Expected chrome or firefox.');
const executable = browser === 'chrome' ? 'chromedriver' : 'geckodriver';
if (spawnSync('bash', ['-lc', 'command -v ' + executable], { encoding: 'utf8' }).status !== 0) {
  throw new Error(executable + ' unavailable; no browser result may be claimed.');
}
const port = browser === 'chrome' ? 9531 : 9532;
const downloadDir = resolve('exhibition-visual-index-downloads-' + browser);
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
    ? { capabilities: { alwaysMatch: { browserName: 'chrome', 'goog:chromeOptions': {
        args: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader'],
        prefs: { 'download.default_directory': downloadDir, 'download.prompt_for_download': false,
          'download.directory_upgrade': true }
      } } } }
    : { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': {
        args: process.env.DISPLAY ? [] : ['-headless'],
        prefs: { 'webgl.disabled': false, 'webgl.force-enabled': true,
          'gfx.webrender.software': true, 'browser.download.dir': downloadDir,
          'browser.download.folderList': 2, 'browser.download.useDownloadDir': true,
          'browser.helperApps.neverAsk.saveToDisk': 'text/csv,application/zip,application/octet-stream',
          'browser.download.alwaysOpenPanel': false }
      } } } };
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
  const boardEnabled = await execute("return !document.getElementById('exhibition-board-save').disabled");
  if (!boardEnabled) throw new Error('Offline board download did not enable after four verified proofs.');
  await execute("window.__boardHtml = null; const native = URL.createObjectURL; URL.createObjectURL = function(blob){ if(blob.type.startsWith('text/html')) blob.text().then(value => { window.__boardHtml = value; }); return native.call(this,blob); }; document.getElementById('exhibition-board-save').click(); URL.createObjectURL = native;");
  let boardHtml = null;
  for (let i = 0; i < 30; i += 1) {
    boardHtml = await execute("return window.__boardHtml");
    if (boardHtml) break;
    await sleep(100);
  }
  if (!boardHtml || (boardHtml.match(/src="data:image\/png;base64,/g) || []).length !== 4 ||
      (boardHtml.match(/<article id="work-/g) || []).length !== 4 ||
      !boardHtml.includes('default-src &#39;none&#39;') ||
      result.tiles.some((tile) => !boardHtml.includes(tile.hash))) {
    throw new Error('Offline HTML download was not backed by four canonical decoded proofs.');
  }
  const board = { enabled: boardEnabled, htmlBytes: new TextEncoder().encode(boardHtml).length,
    imageCount: 4, hashes: result.tiles.map((tile) => tile.hash) };

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
  await request('POST', '/session/' + sessionId + '/window/rect', { width: 1250, height: 900 });
  const studyScreenshot = await request('GET', '/session/' + sessionId + '/screenshot');
  if (!studyScreenshot?.value) throw new Error('Full-window study screenshot absent.');
  await writeFile('exhibition-study-' + browser + '.png', Buffer.from(studyScreenshot.value, 'base64'));
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
  // Rebuild/cancel must revoke the former image lease AND remove the visible
  // old pixels, src and identity labels. Execute both clicks in one DOM turn
  // so cancellation happens before the next requestAnimationFrame.
  const lifecycle = await execute(`
    const index = document.getElementById('exhibition-index-render');
    const cancel = document.getElementById('exhibition-index-cancel');
    const snapshot = () => ({
      visible: document.querySelectorAll('.exhibition-index-image:not([hidden])').length,
      sources: [...document.querySelectorAll('.exhibition-index-image')].filter(img => img.hasAttribute('src')).length,
      identities: document.querySelectorAll('.exhibition-card[data-canonical-rgba-hash]').length,
      boardDisabled: document.getElementById('exhibition-board-save').disabled
    });
    index.click();
    const rebuilding = snapshot();
    cancel.click();
    return { rebuilding, cancelled: snapshot(),
      status: document.getElementById('exhibition-index-status').textContent };
  `);
  for (const state of [lifecycle.rebuilding, lifecycle.cancelled]) {
    if (state.visible || state.sources || state.identities || !state.boardDisabled) {
      throw new Error('Expired canonical index pixels survived rebuild/cancellation: ' + JSON.stringify(lifecycle));
    }
  }
  if (!lifecycle.status.includes('completed proofs remain') ||
      await execute("return !document.getElementById('exhibition-study-launch').disabled")) {
    throw new Error('Cancelled index incorrectly remains available for study: ' + JSON.stringify(lifecycle));
  }
  await sleep(200);
  const lateTiles = await execute("return {shown:document.querySelectorAll('.exhibition-index-image:not([hidden])').length,hashes:document.querySelectorAll('.exhibition-card[data-canonical-rgba-hash]').length}");
  if (lateTiles.shown || lateTiles.hashes) {
    throw new Error('Cancelled asynchronous canonical render resurrected old images: ' + JSON.stringify(lateTiles));
  }
  // Force actual browser image decode rejection. No partial or previous proof
  // is permitted to remain visible or exportable after a failed rebuild.
  await execute("window.__nativeDecode = Image.prototype.decode; Image.prototype.decode = function(){return Promise.reject(new Error('injected-image-decode-failure'))}; document.getElementById('exhibition-index-render').click()");
  let failedIndex = '';
  for (let attempt = 0; attempt < 120; attempt += 1) {
    failedIndex = await execute("return document.getElementById('exhibition-index-status').textContent");
    if (failedIndex.includes('stopped at')) break;
    await sleep(150);
  }
  const failedState = await execute("Image.prototype.decode = window.__nativeDecode; delete window.__nativeDecode; return {visible:document.querySelectorAll('.exhibition-index-image:not([hidden])').length,sources:[...document.querySelectorAll('.exhibition-index-image')].filter(img=>img.hasAttribute('src')).length,hashes:document.querySelectorAll('.exhibition-card[data-canonical-rgba-hash]').length,boardDisabled:document.getElementById('exhibition-board-save').disabled}");
  if (!failedIndex.includes('injected-image-decode-failure') ||
      failedState.visible || failedState.sources || failedState.hashes || !failedState.boardDisabled) {
    throw new Error('Failed canonical index rebuild exposed expired pixels: ' + JSON.stringify({failedIndex,failedState}));
  }
  // Recovery proves invalidation did not poison the genuine CPU index path.
  await execute("document.getElementById('exhibition-index-render').click()");
  let recovered = '';
  for (let attempt = 0; attempt < 160; attempt += 1) {
    recovered = await execute("return document.getElementById('exhibition-index-status').textContent");
    if (recovered.includes('ready:') || recovered.includes('stopped')) break;
    await sleep(250);
  }
  const recoveredState = await execute("return {visible:document.querySelectorAll('.exhibition-index-image:not([hidden])').length,hashes:document.querySelectorAll('.exhibition-card[data-canonical-rgba-hash]').length,boardEnabled:!document.getElementById('exhibition-board-save').disabled}");
  if (!recovered.includes('ready: 4/4') || recoveredState.visible !== 4 ||
      recoveredState.hashes !== 4 || !recoveredState.boardEnabled) {
    throw new Error('Index failed to recover after cleared and rejected proof leases: ' + JSON.stringify({recovered,recoveredState}));
  }
  await writeFile('exhibition-index-lifecycle-' + browser + '.json',
    JSON.stringify({ lifecycle, lateTiles, failedIndex, failedState, recovered, recoveredState }, null, 2) + '\n');
  const offlinePath = resolve('exhibition-offline-board-' + browser + '.html');
  await writeFile(offlinePath, boardHtml);
  await request('POST', '/session/' + sessionId + '/url', { url: pathToFileURL(offlinePath).href });
  let offline = null;
  for (let i = 0; i < 25; i += 1) {
    offline = await execute("return {title:document.title,works:document.querySelectorAll('article.work').length,images:[...document.images].map(img=>({complete:img.complete,width:img.naturalWidth,height:img.naturalHeight})),scripts:document.scripts.length,origin:location.protocol,background:getComputedStyle(document.body).backgroundColor}");
    if (offline?.images?.length === 4 && offline.images.every(img=>img.complete && img.width===96 && img.height===64)) break;
    await sleep(160);
  }
  if (offline.origin !== 'file:' || offline.works !== 4 || offline.scripts !== 0 ||
      offline.images.length !== 4 ||
      offline.images.some(img=>!img.complete || img.width!==96 || img.height!==64)) {
    throw new Error('Saved offline HTML failed real browser file rendering: ' + JSON.stringify(offline));
  }
  // Exercise the new accepted-only A/B index in the *reopened file:// page*,
  // not just the generated string or the live-server study dialog.
  const comparisons = await execute("return [...document.querySelectorAll('#comparison-index tbody tr[data-pair-a]')].map(row=>({a:row.dataset.pairA,b:row.dataset.pairB,different:Number(row.dataset.differences),total:Number(row.dataset.overlap),links:[...row.querySelectorAll('a')].map(a=>a.getAttribute('href'))}))");
  if (comparisons.length !== 6 ||
      new Set(comparisons.map(row => row.a + '/' + row.b)).size !== 6 ||
      comparisons.some(row => !Number.isInteger(row.different) || row.different < 0 ||
        row.total !== 6144 || row.different > row.total ||
        row.links.length !== 5 || row.links[0] !== '#work-' + row.a ||
        row.links[1] !== '#work-' + row.b ||
        !row.links[2].startsWith('data:application/json;base64,') ||
        !row.links[3].startsWith('data:text/csv;base64,') ||
        !row.links[4].startsWith('data:application/zip;base64,')) ||
      !comparisons.some(row => row.a === 'operator-atlas' &&
        row.b === 'timeline-pulse' && row.different === 118)) {
    throw new Error('Offline pairwise comparison did not match accepted CPU identities: ' +
      JSON.stringify(comparisons));
  }
  // Decode the real saved file:// page's receipt links inside Firefox/Chrome.
  // The page itself remains script-free; the WebDriver probe is external.
  const comparisonReceipts = await execute(`return [...document.querySelectorAll('#comparison-index a[download$=".fwcompare.json"]')].map(a=>({name:a.download,data:JSON.parse(atob(a.href.split(',')[1]))}))`);
  if (comparisonReceipts.length !== 6 ||
      comparisonReceipts.some(item => item.data.version !== 'fw-exhibition-ab-comparison-v1' ||
        !item.name.endsWith('.fwcompare.json') ||
        item.data.a.rawRgbaHash.length !== 16 || item.data.b.rawRgbaHash.length !== 16 ||
        item.data.overlap.pixels !== 6144 ||
        !comparisons.some(row => row.a === item.data.a.id && row.b === item.data.b.id &&
          row.different === item.data.overlap.differentPixels))) {
    throw new Error('Offline comparison JSON receipts failed real-browser decoding: ' +
      JSON.stringify(comparisonReceipts));
  }

  // Genuine file:// Enter-key ZIP handoff, not just a decoded data URL.
  const pairBundleLinks = await execute("return [...document.querySelectorAll('#comparison-index a[download$=\".fwabpack.zip\"]')].map(a=>({name:a.download,base64:a.href.split(',')[1],mime:a.href.slice(0,a.href.indexOf(','))}))");
  if (pairBundleLinks.length !== 6 || pairBundleLinks.some((item,i)=>
      item.mime !== 'data:application/zip;base64' ||
      !item.name.includes(comparisons[i].a + '-vs-' + comparisons[i].b) ||
      !item.base64)) {
    throw new Error('Incomplete accepted A/B ZIP handoff in actual offline document.');
  }
  const packFocus = await execute("const a=document.querySelector('#comparison-index a[download$=\".fwabpack.zip\"]');a.scrollIntoView({block:'center',behavior:'instant'});a.focus();return document.activeElement===a && location.protocol==='file:'");
  if (!packFocus) throw new Error('Offline A/B archive export not keyboard-focusable.');
  const packShot = await request('GET','/session/'+sessionId+'/screenshot');
  if (!packShot?.value) throw new Error('Focused A/B archive screenshot missing.');
  await writeFile('exhibition-offline-ab-bundle-'+browser+'.png',Buffer.from(packShot.value,'base64'));
  await request('POST','/session/'+sessionId+'/actions',{actions:[{type:'key',id:'keyboard',actions:[
    {type:'keyDown',value:'\uE007'},{type:'keyUp',value:'\uE007'}]}]});
  await request('DELETE','/session/'+sessionId+'/actions');
  const expectedPairBytes = Buffer.from(pairBundleLinks[0].base64,'base64');
  let savedPairBytes = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      savedPairBytes = await readFile(join(downloadDir,pairBundleLinks[0].name));
      if (savedPairBytes.equals(expectedPairBytes)) break;
    } catch {}
    await sleep(100);
  }
  if (!savedPairBytes?.equals(expectedPairBytes)) {
    throw new Error('Real offline keyboard ZIP download failed source-byte identity.');
  }
  const zipView = new DataView(savedPairBytes.buffer,savedPairBytes.byteOffset,savedPairBytes.byteLength);
  if (zipView.getUint32(savedPairBytes.length-22,true)!==0x06054b50 ||
      zipView.getUint16(savedPairBytes.length-12,true)!==8) {
    throw new Error('Saved offline A/B ZIP lacks eight exact review members.');
  }
  // Keyboard-open the optional exact A/B images in a real offline file:
  // the two visible backgrounds must reuse their own canonical work PNGs.
  const previewSummaries = await execute("return [...document.querySelectorAll('#comparison-index .pair-preview')].map(d=>({a:d.dataset.pairA,b:d.dataset.pairB,summary:d.querySelector('summary')?.textContent,rasters:d.querySelectorAll('.pair-raster').length}))");
  if (previewSummaries.length !== 6 || previewSummaries.some(d=>d.rasters!==2 ||
      d.summary !== 'View exact A/B images' ||
      !comparisons.some(c=>c.a===d.a && c.b===d.b))) {
    throw new Error('Missing accepted-only native pair disclosures: '+JSON.stringify(previewSummaries));
  }
  const previewFocused = await execute("const summary=document.querySelector('#comparison-index .pair-preview summary');summary.scrollIntoView({block:'center',behavior:'instant'});summary.focus();return document.activeElement===summary");
  if (!previewFocused) throw new Error('A/B image disclosure not keyboard-focusable.');
  const pressEnter = async () => request('POST', '/session/' + sessionId + '/actions', {
    actions: [{type:'key',id:'keyboard',actions:[
      {type:'keyDown',value:'\uE007'},{type:'keyUp',value:'\uE007'}
    ]}]
  });
  await pressEnter();
  const previewDesktop = await execute(`const d=document.querySelector('#comparison-index .pair-preview');
    return {opened:d.open,origin:location.protocol,
      images:[...d.querySelectorAll('.pair-raster')].map(el=>{
        const source=document.querySelector('#work-'+el.dataset.workId+' figure img');
        const style=getComputedStyle(el).backgroundImage;
        const box=el.getBoundingClientRect();
        return {id:el.dataset.workId,hash:el.dataset.canonicalHash,
          matchesCanonicalSource:style.includes(source.getAttribute('src')),
          accessible:el.getAttribute('role')==='img' && !!el.getAttribute('aria-label'),
          width:box.width,height:box.height};
      })}`);
  if (!previewDesktop.opened || previewDesktop.origin!=='file:' ||
      previewDesktop.images.length!==2 || previewDesktop.images.some(img=>
        !img.matchesCanonicalSource || !img.accessible || img.width < 180 || img.height < 110 ||
        !result.tiles.some(tile=>tile.id===img.id && tile.hash===img.hash))) {
    throw new Error('Real A/B preview did not display unchanged accepted CPU images: '+
      JSON.stringify(previewDesktop));
  }
  const pairShot=await request('GET','/session/'+sessionId+'/screenshot');
  if (!pairShot?.value) throw new Error('Expanded desktop A/B screenshot absent.');
  await writeFile('exhibition-offline-pair-preview-'+browser+'.png',Buffer.from(pairShot.value,'base64'));
  await pressEnter();
  if (await execute("return document.querySelector('#comparison-index .pair-preview').open")) {
    throw new Error('Keyboard could not collapse A/B disclosure.');
  }
  // Real file:// keyboard inspection of the exact changed-pixel ledger.
  // Independently check every embedded CSV line count against its pair receipt.
  const ledgerLinks = await execute("return [...document.querySelectorAll('#comparison-index a[download$=\".fwpixels.csv\"]')].map(a=>({name:a.download,lines:atob(a.href.split(',')[1]).trimEnd().split('\\n')}))");
  if (ledgerLinks.length !== 6 || ledgerLinks.some((item,i)=>
      item.lines[0] !== 'x,y,a_r,a_g,a_b,a_a,b_r,b_g,b_b,b_a,delta_r,delta_g,delta_b,delta_a' ||
      item.lines.length !== comparisons[i].different + 1 ||
      item.lines.slice(1).some(line=>line.split(',').length !== 14))) {
    throw new Error('Offline exact changed-pixel CSV differs from accepted comparison totals: ' +
      JSON.stringify(ledgerLinks.map(item=>({name:item.name,count:item.lines.length-1}))));
  }
  // Verify a physical user-initiated CSV download from the actual offline
  // board, not only a syntactically valid data URL. The generated CSV is
  // independently decoded by the Node source-RGBA test.
  const ledgerDownload = await execute("const a=document.querySelector('#comparison-index a[download$=\".fwpixels.csv\"]');a.scrollIntoView({block:'center',behavior:'instant'});a.focus();return {name:a.download,focused:document.activeElement===a,origin:location.protocol}");
  if (!ledgerDownload.focused || ledgerDownload.origin!=='file:' ||
      ledgerDownload.name!==ledgerLinks[0].name) {
    throw new Error('Offline CSV download was not keyboard focusable: ' +
      JSON.stringify(ledgerDownload));
  }
  await pressEnter();
  await request('DELETE', '/session/' + sessionId + '/actions');
  let persistedCsv = null, downloadFailure = 'not created';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      persistedCsv = await readFile(join(downloadDir, ledgerDownload.name), 'utf8');
      if (persistedCsv === ledgerLinks[0].lines.join('\n') + '\n') break;
      downloadFailure = 'incomplete or mismatched bytes (' + persistedCsv.length + ')';
    } catch (error) { downloadFailure = error?.message ?? String(error); }
    await sleep(100);
  }
  if (persistedCsv !== ledgerLinks[0].lines.join('\n') + '\n') {
    throw new Error('Real keyboard offline CSV export did not persist exact bytes: ' + downloadFailure);
  }
  const ledgerFocused = await execute("const summary=document.querySelector('#comparison-index .pair-pixels summary');summary.scrollIntoView({block:'center',behavior:'instant'});summary.focus();return document.activeElement===summary");
  if (!ledgerFocused) throw new Error('Exact pixel ledger disclosure not keyboard-focusable.');
  await pressEnter();
  const ledgerOpen = await execute("const d=document.querySelector('#comparison-index .pair-pixels');return {open:d.open,rows:d.querySelectorAll('tbody tr[data-pixel-x]').length,expected:Number(d.dataset.count),first:d.querySelector('tbody tr')?.textContent,keyboardScroll:d.querySelector('[role=region]')?.tabIndex===0,origin:location.protocol}");
  if (!ledgerOpen.open || ledgerOpen.rows !== comparisons[0].different ||
      ledgerOpen.expected !== ledgerOpen.rows || !ledgerOpen.first ||
      !ledgerOpen.keyboardScroll || ledgerOpen.origin !== 'file:') {
    throw new Error('Real offline changed-pixel table failed keyboard inspection: ' +
      JSON.stringify(ledgerOpen));
  }
  // The locator is now an actual navigation surface: every real decoded
  // change has one local fragment linking back to the original ledger row.
  // A bounded five-item strongest-change list provides a keyboard route
  // without creating hundreds of one-pixel Tab stops inside the SVG.
  const navigationSource = await execute(`const d=document.querySelector('#comparison-index .pair-pixels');
    const rows=[...d.querySelectorAll('tbody tr[data-pixel-x]')];
    const mapLinks=[...d.querySelectorAll('svg.pair-locator a')];
    const hotspots=[...d.querySelectorAll('.pair-hotspots a')];
    const rowIds=new Set(rows.map(row=>row.id));
    const validMap=mapLinks.length===rows.length && mapLinks.every((link,i)=>{
      const mark=link.querySelector('rect');
      return link.getAttribute('href')==='#'+rows[i].id &&
        link.getAttribute('tabindex')==='-1' &&
        mark?.getAttribute('x')===rows[i].dataset.pixelX &&
        mark?.getAttribute('y')===rows[i].dataset.pixelY;
    });
    return {origin:location.protocol,scripts:document.scripts.length,
      rows:rows.length,markerLinks:mapLinks.length,hotspots:hotspots.length,
      validMap,validHotspots:hotspots.every(link=>rowIds.has(link.hash.slice(1))),
      navigationRole:d.querySelector('.pair-hotspots').getAttribute('role')};`);
  if (navigationSource.origin!=='file:' || navigationSource.scripts!==0 ||
      !navigationSource.validMap || !navigationSource.validHotspots ||
      navigationSource.markerLinks!==comparisons[0].different ||
      navigationSource.hotspots!==5 || navigationSource.navigationRole!=='navigation') {
    throw new Error('Source-exact offline jump links did not bind original ledger rows: '+
      JSON.stringify(navigationSource));
  }
  const jumpFocus = await execute(`const link=document.querySelector('#comparison-index .pair-pixels .pair-hotspots a');
    link.scrollIntoView({block:'center',behavior:'instant'});link.focus();
    return {focused:document.activeElement===link,hash:link.hash,protocol:location.protocol};`);
  if (!jumpFocus.focused || !jumpFocus.hash.startsWith('#ab-') || jumpFocus.protocol!=='file:') {
    throw new Error('Strongest exact change not reachable by keyboard: '+JSON.stringify(jumpFocus));
  }
  await pressEnter();
  const jumpResult = await execute(`const target=document.getElementById(location.hash.slice(1));
    const scroll=target?.closest('.pair-pixel-scroll');
    const rect=target?.getBoundingClientRect(), viewport=scroll?.getBoundingClientRect();
    return {hash:location.hash,row:!!target,selected:target?.matches(':target'),
      changedColor:target?getComputedStyle(target).backgroundColor:'',
      inScrollableLedger:!!scroll,withinViewport:!!rect&&!!viewport &&
        rect.top>=viewport.top-3 && rect.top<viewport.bottom+3,origin:location.protocol};`);
  if (jumpResult.hash!==jumpFocus.hash || !jumpResult.row ||
      !jumpResult.selected || !jumpResult.inScrollableLedger ||
      !jumpResult.withinViewport || jumpResult.origin!=='file:') {
    throw new Error('Real keyboard jump did not reveal source RGBA8 row: '+JSON.stringify(jumpResult));
  }
  // Exercise a physical WebDriver pointer click on the tiny real SVG marker,
  // rather than merely checking markup or dispatching a synthetic click.
  const pointerDestination = await execute(`const link=[...document.querySelectorAll('#comparison-index .pair-pixels svg.pair-locator a')].at(-1);
    link.scrollIntoView({block:'center',behavior:'instant'});
    return link.getAttribute('href');`);
  const elementReply = await request('POST','/session/'+sessionId+'/element',{
    using:'css selector',value:'#comparison-index .pair-pixels svg.pair-locator a:last-child'});
  const elementId = elementReply?.value?.['element-6066-11e4-a52e-4f735466cecf'];
  if (!elementId) throw new Error('WebDriver did not locate physical SVG pixel marker.');
  await request('POST','/session/'+sessionId+'/element/'+elementId+'/click');
  const pointerResult = await execute(`const row=document.getElementById(location.hash.slice(1));
    return {hash:location.hash,valid:!!row&&row.matches(':target'),
      coordinates:row?.dataset.pixelX+','+row?.dataset.pixelY,
      file:location.protocol,scriptCount:document.scripts.length};`);
  if (pointerResult.hash!==pointerDestination || !pointerResult.valid ||
      pointerResult.file!=='file:' || pointerResult.scriptCount!==0) {
    throw new Error('Real marker pointer activation did not navigate to original pixel: '+
      JSON.stringify(pointerResult));
  }
  const navigationShot=await request('GET','/session/'+sessionId+'/screenshot');
  if (!navigationShot?.value) throw new Error('Exact pixel navigation screenshot absent.');
  await writeFile('exhibition-offline-pixel-navigation-'+browser+'.png',
    Buffer.from(navigationShot.value,'base64'));
  // Validate swatch custody against accessible numeric bytes in actual offline
  // Firefox/Chrome, not only in a generated HTML string.
  const swatchBrowser = await execute(`const disclosures=[...document.querySelectorAll('#comparison-index .pair-pixels')];
    const rows=disclosures.flatMap(d=>[...d.querySelectorAll('tbody tr[data-pixel-x]')]);
    const valid=rows.every(row=>[1,2].every(index=>{
      const swatch=row.cells[index].querySelector('.pair-swatch');
      const fill=swatch?.querySelector('.pair-swatch-fill');
      const text=row.cells[index].querySelector('code')?.textContent;
      const expected=text?.split(',').map(part=>part.trim()).join(',');
      return !!swatch && !!fill && swatch.getAttribute('aria-hidden')==='true' &&
        swatch.dataset.rgba8===expected && !!fill.style.backgroundColor;
    }));
    const first=disclosures[0].querySelector('.pair-swatch').getBoundingClientRect();
    return {origin:location.protocol,scripts:document.scripts.length,
      rows:rows.length,swatches:document.querySelectorAll('#comparison-index .pair-swatch').length,
      valid,visibleWidth:first.width,visibleHeight:first.height};`);
  if (swatchBrowser.origin!=='file:' || swatchBrowser.scripts!==0 ||
      swatchBrowser.rows!==comparisons.reduce((n,item)=>n+item.different,0) ||
      swatchBrowser.swatches!==swatchBrowser.rows*2 || !swatchBrowser.valid ||
      swatchBrowser.visibleWidth<16 || swatchBrowser.visibleHeight<16) {
    throw new Error('Real offline exact RGBA8 colour samples failed: '+JSON.stringify(swatchBrowser));
  }
  // Pixel positions must be browser-visible under file:// CSP with no script
  // running in the generated document. The diagnostic is deliberately not
  // another canonical artwork: compare every mark to the exact numeric table.
  const locatorVisual = await execute(`const d=document.querySelector('#comparison-index .pair-pixels');
    const svg=d.querySelector('svg.pair-locator');
    const marks=[...svg.querySelectorAll('rect[fill="#e4b665"]')]
      .map(r=>r.getAttribute('x')+','+r.getAttribute('y'));
    const rows=[...d.querySelectorAll('tbody tr[data-pixel-x]')]
      .map(r=>r.dataset.pixelX+','+r.dataset.pixelY);
    const rect=svg.getBoundingClientRect();
    return {origin:location.protocol,role:svg.getAttribute('role'),
      labelled:svg.getAttribute('aria-label')?.includes('Diagnostic image-local'),
      count:Number(svg.dataset.diffCount),marks:marks.length,
      matchesRows:JSON.stringify(marks)===JSON.stringify(rows),
      viewBox:svg.getAttribute('viewBox'),width:rect.width,height:rect.height,
      scripts:document.scripts.length};`);
  if (locatorVisual.origin!=='file:' || locatorVisual.role!=='img' ||
      !locatorVisual.labelled || locatorVisual.count!==comparisons[0].different ||
      locatorVisual.marks!==comparisons[0].different ||
      !locatorVisual.matchesRows || locatorVisual.viewBox!=='0 0 96 64' ||
      locatorVisual.width < 200 || locatorVisual.height < 100 ||
      locatorVisual.scripts!==0) {
    throw new Error('Offline browser source-exact difference locator failed: '+
      JSON.stringify(locatorVisual));
  }
  const ledgerShot=await request('GET','/session/'+sessionId+'/screenshot');
  if (!ledgerShot?.value) throw new Error('Exact changed-pixel ledger screenshot absent.');
  await writeFile('exhibition-offline-pixel-ledger-'+browser+'.png',
    Buffer.from(ledgerShot.value,'base64'));
  const swatchDesktopFocus = await execute("const r=document.querySelector('#comparison-index .pair-pixels .pair-pixel-scroll');r.scrollIntoView({block:'center',behavior:'instant'});r.focus();return document.activeElement===r");
  if (!swatchDesktopFocus) throw new Error('RGBA8 swatch table lost keyboard access.');
  const swatchDesktopShot = await request('GET','/session/'+sessionId+'/screenshot');
  if (!swatchDesktopShot?.value) throw new Error('RGBA8 desktop screenshot absent.');
  await writeFile('exhibition-offline-pixel-swatches-'+browser+'.png',
    Buffer.from(swatchDesktopShot.value,'base64'));
  await execute("document.querySelector('#comparison-index .pair-pixels summary').focus()");
  await pressEnter();
  if (await execute("return document.querySelector('#comparison-index .pair-pixels').open")) {
    throw new Error('Keyboard could not collapse exact pixel ledger.');
  }
  await request('POST', '/session/' + sessionId + '/window/rect', { width: 390, height: 790 });
  const comparisonNarrow = await execute("const section=document.getElementById('comparison-index');section.scrollIntoView({block:'start',behavior:'instant'});const region=document.getElementById('comparison-scroll');region.focus({preventScroll:true});return {protocol:location.protocol,viewport:document.documentElement.clientWidth,focused:document.activeElement===region,tableRows:region.querySelectorAll(':scope > table > tbody > tr').length,horizontalOverflow:region.scrollWidth>region.clientWidth,top:Math.round(region.getBoundingClientRect().top),viewportHeight:innerHeight}");
  if (comparisonNarrow.protocol !== 'file:' || comparisonNarrow.viewport > 600 ||
      !comparisonNarrow.focused || comparisonNarrow.tableRows !== 6 ||
      !comparisonNarrow.horizontalOverflow || comparisonNarrow.top < 0 ||
      comparisonNarrow.top > comparisonNarrow.viewportHeight - 150) {
    throw new Error('Offline keyboard/narrow comparison index failed: ' +
      JSON.stringify(comparisonNarrow));
  }
  const comparisonScreenshot = await request('GET', '/session/' + sessionId + '/screenshot');
  if (!comparisonScreenshot?.value) throw new Error('Offline comparison screenshot absent.');
  await writeFile('exhibition-offline-comparisons-' + browser + '.png',
    Buffer.from(comparisonScreenshot.value, 'base64'));
  const narrowPreviewFocused = await execute("const s=document.querySelector('#comparison-index .pair-preview summary');s.scrollIntoView({block:'center',behavior:'instant'});s.focus();return document.activeElement===s");
  if (!narrowPreviewFocused) throw new Error('Narrow A/B preview summary lost keyboard access.');
  await pressEnter();
  const previewNarrow = await execute(`const d=document.querySelector('#comparison-index .pair-preview');
    const frames=[...d.querySelectorAll('.pair-raster')].map(el=>el.getBoundingClientRect());
    return {open:d.open,columns:getComputedStyle(d.querySelector('.pair-images')).gridTemplateColumns,
      ordered:frames.length===2 && frames[1].top>=frames[0].bottom,
      width:document.documentElement.clientWidth,
      bodyOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};`);
  if (!previewNarrow.open || !previewNarrow.ordered || previewNarrow.bodyOverflow ||
      previewNarrow.width>600 || previewNarrow.columns.split(' ').length!==1) {
    throw new Error('Responsive keyboard A/B proof preview failed: '+JSON.stringify(previewNarrow));
  }
  const pairNarrowShot=await request('GET','/session/'+sessionId+'/screenshot');
  if (!pairNarrowShot?.value) throw new Error('Narrow A/B pair screenshot absent.');
  await writeFile('exhibition-offline-pair-preview-narrow-'+browser+'.png',
    Buffer.from(pairNarrowShot.value,'base64'));
  // The diagnostic locator must fit a narrow viewport and retain keyboard
  // access on an actual file:// board, without body-level horizontal overflow.
  const narrowLocatorFocus = await execute("const s=document.querySelector('#comparison-index .pair-pixels summary');s.scrollIntoView({block:'center',behavior:'instant'});s.focus();return document.activeElement===s");
  if (!narrowLocatorFocus) throw new Error('Narrow offline diagnostic locator lost keyboard access.');
  await pressEnter();
  const narrowLocator = await execute(`const d=document.querySelector('#comparison-index .pair-pixels');
    const r=d.querySelector('svg.pair-locator').getBoundingClientRect();
    return {open:d.open,protocol:location.protocol,marks:d.querySelectorAll('svg.pair-locator rect[fill="#e4b665"]').length,
      rectWidth:r.width,rectHeight:r.height,viewport:document.documentElement.clientWidth,
      bodyOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};`);
  if (!narrowLocator.open || narrowLocator.protocol!=='file:' ||
      narrowLocator.marks!==comparisons[0].different ||
      narrowLocator.rectWidth<=80 || narrowLocator.rectWidth>narrowLocator.viewport ||
      narrowLocator.rectHeight<=40 || narrowLocator.bodyOverflow) {
    throw new Error('Narrow offline source-exact locator failed: ' + JSON.stringify(narrowLocator));
  }
  const narrowLocatorShot = await request('GET', '/session/' + sessionId + '/screenshot');
  if (!narrowLocatorShot?.value) throw new Error('Narrow difference locator screenshot absent.');
  await writeFile('exhibition-offline-pixel-locator-narrow-'+browser+'.png',
    Buffer.from(narrowLocatorShot.value,'base64'));
  const narrowSwatches = await execute(`const region=document.querySelector('#comparison-index .pair-pixels .pair-pixel-scroll');
    region.scrollIntoView({block:'center',behavior:'instant'});region.focus();
    const box=region.querySelector('.pair-swatch').getBoundingClientRect();
    return {focused:document.activeElement===region,visible:box.width>=16&&box.height>=16,
      bodyOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};`);
  if (!narrowSwatches.focused || !narrowSwatches.visible || narrowSwatches.bodyOverflow) {
    throw new Error('Narrow offline RGBA8 swatch inspection failed: '+JSON.stringify(narrowSwatches));
  }
  const narrowSwatchShot=await request('GET','/session/'+sessionId+'/screenshot');
  if (!narrowSwatchShot?.value) throw new Error('Narrow RGBA8 swatch screenshot absent.');
  await writeFile('exhibition-offline-pixel-swatches-narrow-'+browser+'.png',
    Buffer.from(narrowSwatchShot.value,'base64'));
  await execute("document.querySelector('#comparison-index .pair-pixels summary').focus()");
  await pressEnter();

  await request('POST', '/session/' + sessionId + '/window/rect', { width: 1250, height: 900 });
  await execute("window.scrollTo(0,0)");
  const boardScreenshot = await request('GET', '/session/' + sessionId + '/screenshot');
  if (!boardScreenshot?.value) throw new Error('Offline board screenshot absent.');
  await writeFile('exhibition-offline-board-' + browser + '.png', Buffer.from(boardScreenshot.value, 'base64'));
  await writeFile('exhibition-visual-index-' + browser + '.json', JSON.stringify({ browser, initial, result, board, selected, offline, comparisons,
      acceptedPairBundle: { name: pairBundleLinks[0].name, bytes: savedPairBytes.length, exactMatch: true },
      comparisonReceipts: comparisonReceipts.map(item => ({
        name: item.name, a: item.data.a.id, b: item.data.b.id,
        changed: item.data.overlap.differentPixels
      })), comparisonNarrow }, null, 2) + '\n');
  console.log(JSON.stringify({ browser, status:'four actual decoded canonical CPU images', hashes:result.tiles.map((tile) => tile.hash), selected:selected.id }, null, 2));
} finally {
  if (sessionId) { try { await request('DELETE', '/session/' + sessionId); } catch { /* cleanup */ } }
  driver.kill('SIGTERM');
}
