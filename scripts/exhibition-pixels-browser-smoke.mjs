import { spawn, spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodePngRgba, rawRgbaHash } from '../src/export/index.js';

const browser = process.argv[2] ?? 'firefox';
if (!['chrome', 'firefox'].includes(browser)) throw new Error('Expected chrome or firefox.');
const executable = browser === 'chrome' ? 'chromedriver' : 'geckodriver';
if (spawnSync('bash', ['-lc', 'command -v ' + executable], { encoding: 'utf8' }).status !== 0) {
  throw new Error(executable + ' unavailable; no browser result may be claimed.');
}
const port = browser === 'chrome' ? 9531 : 9532;
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
    ? { capabilities: { alwaysMatch: { browserName: 'chrome', 'goog:chromeOptions': { args: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader'] } } } }
    : { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { args: process.env.DISPLAY ? [] : ['-headless'], prefs: { 'webgl.disabled': false, 'webgl.force-enabled': true, 'gfx.webrender.software': true } } } } };
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
  await request('POST', '/session/' + sessionId + '/window/rect', { width: 1250, height: 900 });
  const studyScreenshot = await request('GET', '/session/' + sessionId + '/screenshot');
  if (!studyScreenshot?.value) throw new Error('Full-window study screenshot absent.');
  await writeFile('exhibition-study-' + browser + '.png', Buffer.from(studyScreenshot.value, 'base64'));
  // Exercise the actual browser's decoded CPU-pixel inspection, not WebGL.
  await execute("document.getElementById('exhibition-study-pixel-toggle').click(); const x=document.getElementById('exhibition-study-pixel-x');const y=document.getElementById('exhibition-study-pixel-y');x.value='3';y.value='7';x.dispatchEvent(new Event('input',{bubbles:true}))");
  let sampled;
  for(let i=0;i<50;i++){
    sampled=await execute("return {text:document.getElementById('exhibition-study-pixel-reading').textContent,neighbours:document.querySelectorAll('.exhibition-study-pixel-cell').length,centres:document.querySelectorAll('.exhibition-study-pixel-cell.is-centre').length,colour:document.querySelector('.exhibition-study-pixel-cell.is-centre')?.style.backgroundColor,expanded:document.getElementById('exhibition-study-pixel-toggle').getAttribute('aria-expanded')}");
    if(sampled.text.includes('(3, 7)')) break;
    await sleep(100);
  }
  if(!sampled.text.includes('(3, 7)') || !sampled.text.includes('RGBA8') ||
     sampled.neighbours!==81 || sampled.centres!==1 || !sampled.colour || sampled.expanded!=='true') {
    throw new Error('Exact decoded pixel inspection failed: '+JSON.stringify(sampled));
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
  await writeFile('exhibition-pixels-'+browser+'.json',JSON.stringify({browser,sampled,aPixel,marked},null,2)+'\n');
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
      offlinePage.articleIds.length !== 4 || offlinePage.anchors.length !== 4 ||
      offlinePage.scriptCount !== 0 || offlinePage.externalResources.length !== 0 ||
      encoded.some((match) => !offlinePage.articleIds.includes('work-' + match[1]) ||
        !offlinePage.bodyText.includes(offlineDecoded.find((p) => p.id === match[1]).hash)) ||
      /UNMERGED CANDIDATE/i.test(offlinePage.bodyText)) {
    throw new Error('Reopened offline exhibition changed acceptance, CSP or proof details: ' +
      JSON.stringify({ heading:offlinePage.heading, csp:offlinePage.csp,
        ids:offlinePage.articleIds, anchors:offlinePage.anchors,
        scripts:offlinePage.scriptCount, remote:offlinePage.externalResources }));
  }
  const offlineScreenshot = await request('GET','/session/' + sessionId + '/screenshot');
  if (!offlineScreenshot?.value) throw new Error('Offline board desktop screenshot absent.');
  await writeFile('exhibition-accepted-offline-' + browser + '.png',
    Buffer.from(offlineScreenshot.value,'base64'));
  await request('POST', '/session/' + sessionId + '/window/rect', { width:390, height:844 });
  await execute("document.querySelector('nav a[href=\"#work-operator-atlas\"]').focus()");
  await pressPixelKey('\uE007'); // Enter on a real in-document navigation link
  const offlineNarrow = await execute("return {hash:location.hash,focus:document.activeElement.getAttribute('href'),width:innerWidth,scrollWidth:document.documentElement.scrollWidth,articleCount:document.querySelectorAll('main article.work').length}");
  if (offlineNarrow.hash !== '#work-operator-atlas' ||
      offlineNarrow.focus !== '#work-operator-atlas' ||
      offlineNarrow.width > 550 || offlineNarrow.scrollWidth > offlineNarrow.width + 1 ||
      offlineNarrow.articleCount !== 4) {
    throw new Error('Offline keyboard navigation or narrow layout failed: ' +
      JSON.stringify(offlineNarrow));
  }
  const offlineNarrowScreenshot = await request('GET','/session/' + sessionId + '/screenshot');
  if (!offlineNarrowScreenshot?.value) throw new Error('Offline board narrow screenshot absent.');
  await writeFile('exhibition-accepted-offline-narrow-' + browser + '.png',
    Buffer.from(offlineNarrowScreenshot.value,'base64'));
  await writeFile('exhibition-accepted-offline-' + browser + '.json',
    JSON.stringify({ browser, source:'existing study export HTML Blob; Node decoded RGBA8 independently',
      offlineDecoded, verifiedFromFileUrl:true, offlineNarrow,
      title:offlinePage.title, csp:offlinePage.csp },null,2) + '\n');

  console.log(JSON.stringify({ browser, status:'four actual decoded canonical CPU images', hashes:result.tiles.map((tile) => tile.hash), selected:selected.id }, null, 2));
} finally {
  if (sessionId) { try { await request('DELETE', '/session/' + sessionId); } catch { /* cleanup */ } }
  driver.kill('SIGTERM');
}
