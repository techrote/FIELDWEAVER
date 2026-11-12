import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getBuiltinPreset } from '../src/presets/index.js';
import { parseRecipe, recipeHash, serializeRecipe } from '../src/recipe/index.js';

const browser = process.argv[2];
if (!['chrome', 'firefox'].includes(browser)) throw new Error('Usage: node scripts/release-browser-smoke.mjs <chrome|firefox>');
const driverName = browser === 'chrome' ? 'chromedriver' : 'geckodriver';
const port = browser === 'chrome' ? 9518 : 4447;
const baseUrl = `http://127.0.0.1:${port}`;
const appUrl = process.env.FIELDWEAVER_SMOKE_URL ?? 'http://127.0.0.1:4173/';
const evidencePath = `release-smoke-${browser}.log`;
const downloadDir = await mkdtemp(join(tmpdir(), `fieldweaver-gallery-${browser}-`));

function commandPath(name) {
  const result = spawnSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() || null : null;
}
const driverPath = commandPath(driverName);
if (!driverPath) throw new Error(`${driverName} is not available on PATH; release browser smoke cannot be claimed.`);
const driver = spawn(driverPath, browser === 'chrome' ? [`--port=${port}`] : ['--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
let driverLog = '';
driver.stdout.on('data', (chunk) => { driverLog += chunk.toString(); });
driver.stderr.on('data', (chunk) => { driverLog += chunk.toString(); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(method, path, body = undefined) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  if (text) payload = JSON.parse(text);
  if (!response.ok) throw new Error(`${method} ${path} failed ${response.status}: ${text.slice(0, 800)}`);
  return payload;
}
async function waitForDriver() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { if ((await request('GET', '/status'))?.value?.ready !== false) return; } catch { /* retry */ }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${driverName}.\n${driverLog}`);
}
function capabilities() {
  if (browser === 'chrome') return { capabilities: { alwaysMatch: { browserName: 'chrome', 'goog:chromeOptions': {
    args: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader'],
    prefs: { 'download.default_directory': downloadDir, 'download.prompt_for_download': false, 'download.directory_upgrade': true }
  } } } };
  return { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': {
    args: process.env.DISPLAY ? [] : ['-headless'],
    prefs: { 'webgl.disabled': false, 'webgl.force-enabled': true, 'gfx.webrender.software': true,
      'browser.download.dir': downloadDir, 'browser.download.folderList': 2, 'browser.download.useDownloadDir': true,
      'browser.helperApps.neverAsk.saveToDisk': 'application/json,application/octet-stream',
      'browser.download.alwaysOpenPanel': false }
  } } } };
}

let sessionId = null;
try {
  await waitForDriver();
  const created = await request('POST', '/session', capabilities());
  sessionId = created?.value?.sessionId ?? created?.sessionId;
  if (!sessionId) throw new Error(`WebDriver session missing: ${JSON.stringify(created)}`);
  await request('POST', `/session/${sessionId}/url`, { url: appUrl });
  const execute = async (script) => (await request('POST', `/session/${sessionId}/execute/sync`, { script, args: [] }))?.value;

  const snapshot = async () => execute(`
    const root = document.documentElement;
    const canvas = document.querySelector('#preview-canvas');
    const fields = document.querySelector('#field-list');
    return {
      releaseReady: root.dataset.fieldweaverReleaseReady ?? '',
      renderer: root.dataset.fieldweaverRendererState ?? '',
      editor: root.dataset.fieldweaverEditorState ?? '',
      presetReady: document.querySelector('.preset-panel')?.dataset.ready ?? '',
      presetOptions: document.querySelector('#preset-select')?.options.length ?? 0,
      presetId: root.dataset.fieldweaverPresetId ?? '',
      presetHash: root.dataset.fieldweaverPresetRecipeHash ?? '',
      canonicalHash: root.dataset.fieldweaverCanonicalRecipeHash ?? '',
      canvasRole: canvas?.getAttribute('role') ?? '',
      canvasDescribedBy: canvas?.getAttribute('aria-describedby') ?? '',
      fieldRole: fields?.getAttribute('role') ?? '',
      badFieldRoles: [...(fields?.querySelectorAll('[data-field-id]') ?? [])].filter((node) => node.getAttribute('role') === 'option').length,
      releaseDiagnostics: [...document.querySelectorAll('#release-diagnostics li')].map((node) => node.textContent ?? ''),
      presetStatus: document.querySelector('#preset-status')?.textContent ?? ''
    };
  `);

  const deadline = Date.now() + 20_000;
  let initial;
  while (Date.now() < deadline) {
    initial = await snapshot();
    if (initial?.releaseReady === 'true' && initial.renderer === 'ready' && initial.editor === 'ready' && initial.presetReady === 'true') break;
    await sleep(200);
  }
  if (!initial || initial.releaseReady !== 'true' || initial.renderer !== 'ready' || initial.editor !== 'ready' || initial.presetReady !== 'true') throw new Error(`Release UI did not become ready: ${JSON.stringify(initial)}`);
  if (initial.presetOptions !== 4) throw new Error(`Expected four curated presets, found ${initial.presetOptions}.`);
  if (initial.canvasRole !== 'region' || !initial.canvasDescribedBy || initial.fieldRole !== 'group' || initial.badFieldRoles !== 0) throw new Error(`Accessibility normalization failed: ${JSON.stringify(initial)}`);
  if (!initial.releaseDiagnostics.some((line) => line.includes('Mode boundary: canonical CPU'))) throw new Error(`Release diagnostics lack canonical/noncanonical boundary: ${JSON.stringify(initial.releaseDiagnostics)}`);

  // Real WebDriver keyboard activation, browser download and disk byte check.
  // No blob: fetch (forbidden by CSP), synthetic click or fake download.
  const editorBeforeHandoff = (await snapshot()).canonicalHash;
  const accepted = getBuiltinPreset('first-weave');
  const filename = 'fieldweaver-first-weave-' + accepted.recipeHash + '.fwrecipe.json';
  const savedPath = join(downloadDir, filename);
  await execute("document.querySelector('[data-exhibition-id=\"first-weave\"]').click();document.querySelector('#exhibition-download-recipe').focus()");
  const enter = String.fromCharCode(0xe007);
  await request('POST', `/session/${sessionId}/actions`, {
    actions: [{ type: 'key', id: 'gallery-download-key', actions: [
      { type: 'keyDown', value: enter }, { type: 'keyUp', value: enter }
    ] }]
  });
  await request('DELETE', `/session/${sessionId}/actions`);
  let downloaded = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { downloaded = await readFile(savedPath, 'utf8'); } catch { /* still downloading */ }
    if (downloaded === serializeRecipe(accepted.recipe)) break;
    await sleep(100);
  }
  const recipeHandoff = await execute(`
    return { status: document.querySelector('#preset-status').textContent,
      proofPending: document.querySelector('#exhibition-download-png').disabled,
      selected: document.querySelector('#preset-select').value,
      focus: document.activeElement.id };
  `);
  if (downloaded !== serializeRecipe(accepted.recipe) ||
      recipeHash(parseRecipe(downloaded)) !== accepted.recipeHash ||
      recipeHandoff.selected !== 'first-weave' ||
      recipeHandoff.focus !== 'exhibition-download-recipe' ||
      !recipeHandoff.proofPending ||
      !recipeHandoff.status.includes('editor unchanged') ||
      (await snapshot()).canonicalHash !== editorBeforeHandoff) {
    throw new Error('Real gallery recipe download failed file identity, keyboard or editor isolation: ' +
      JSON.stringify({ filename, downloadedBytes: downloaded?.length, recipeHandoff }));
  }
  await writeFile('release-exhibition-recipe-download-' + browser + '.fwrecipe.json', downloaded);
  await writeFile('release-exhibition-recipe-download-' + browser + '.json',
    JSON.stringify({ browser, filename, recipeHash: accepted.recipeHash,
      bytes: Buffer.byteLength(downloaded), keyboardEnter: true, actualSavedFile: true,
      editorPreserved: true, proofPending: recipeHandoff.proofPending }, null, 2) + '\n');
  await execute(`document.querySelector('#exhibition-download-recipe').scrollIntoView({ block: 'center' });`);
  const recipeCapture = await request('GET', `/session/${sessionId}/screenshot`);
  if (!recipeCapture?.value) throw new Error('Browser did not return gallery recipe handoff screenshot.');
  await writeFile('release-exhibition-recipe-' + browser + '.png', Buffer.from(recipeCapture.value, 'base64'));

  // Narrow-viewport, keyboard-only selection after a successful download.
  // This also guards against exporting the previous selected recipe from a stale closure.
  await request('POST', '/session/' + sessionId + '/window/rect', { width: 390, height: 780 });
  await execute("document.querySelector('[data-exhibition-id=\"operator-atlas\"]').focus()");
  await request('POST', '/session/' + sessionId + '/actions', {
    actions: [{ type: 'key', id: 'gallery-switch-key', actions: [
      { type: 'keyDown', value: enter }, { type: 'keyUp', value: enter }
    ] }]
  });
  await request('DELETE', '/session/' + sessionId + '/actions');
  const switched = await execute("return {selected:document.querySelector('#preset-select').value,pressed:document.querySelector('.exhibition-card[aria-pressed=\"true\"]')?.dataset.exhibitionId,focus:document.activeElement.dataset.exhibitionId||'',proofDisabled:document.querySelector('#exhibition-download-png').disabled,proofHash:document.documentElement.dataset.fieldweaverExhibitionProofHash||'',width:window.innerWidth}");
  if (switched.selected !== 'operator-atlas' || switched.pressed !== 'operator-atlas' ||
      switched.focus !== 'operator-atlas' || !switched.proofDisabled || switched.proofHash ||
      switched.width > 500) {
    throw new Error('Narrow keyboard selection retained stale gallery state: ' + JSON.stringify(switched));
  }
  const switchedPreset = getBuiltinPreset('operator-atlas');
  const switchedFilename = 'fieldweaver-operator-atlas-' + switchedPreset.recipeHash + '.fwrecipe.json';
  const switchedPath = join(downloadDir, switchedFilename);
  await execute("document.querySelector('#exhibition-download-recipe').focus()");
  await request('POST', '/session/' + sessionId + '/actions', {
    actions: [{ type: 'key', id: 'gallery-switched-download-key', actions: [
      { type: 'keyDown', value: enter }, { type: 'keyUp', value: enter }
    ] }]
  });
  await request('DELETE', '/session/' + sessionId + '/actions');
  let switchedBytes = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { switchedBytes = await readFile(switchedPath, 'utf8'); } catch { /* browser still writing */ }
    if (switchedBytes === serializeRecipe(switchedPreset.recipe)) break;
    await sleep(100);
  }
  const switchedStatus = await execute("return {text:document.querySelector('#preset-status').textContent,selected:document.querySelector('#preset-select').value,focus:document.activeElement.id}");
  if (switchedBytes !== serializeRecipe(switchedPreset.recipe) ||
      recipeHash(parseRecipe(switchedBytes)) !== switchedPreset.recipeHash ||
      switchedStatus.selected !== 'operator-atlas' ||
      switchedStatus.focus !== 'exhibition-download-recipe' ||
      !switchedStatus.text.includes(switchedFilename) ||
      (await snapshot()).canonicalHash !== editorBeforeHandoff ||
      (await readFile(savedPath, 'utf8')) !== downloaded) {
    throw new Error('Switched accepted recipe was not a source-exact, isolated keyboard download: ' +
      JSON.stringify({ switched, switchedStatus, savedBytes: switchedBytes?.length }));
  }
  await writeFile('release-exhibition-recipe-switched-' + browser + '.fwrecipe.json', switchedBytes);
  await writeFile('release-exhibition-recipe-switched-' + browser + '.json',
    JSON.stringify({ browser, switched, switchedStatus, filename: switchedFilename,
      recipeHash: switchedPreset.recipeHash, bytes: Buffer.byteLength(switchedBytes),
      realKeyboardSelection: true, realKeyboardDownload: true, editorPreserved: true }, null, 2) + '\n');
  const narrowCapture = await request('GET', '/session/' + sessionId + '/screenshot');
  if (!narrowCapture?.value) throw new Error('Narrow gallery recipe screenshot absent.');
  await writeFile('release-exhibition-recipe-narrow-' + browser + '.png',
    Buffer.from(narrowCapture.value, 'base64'));
  await request('POST', '/session/' + sessionId + '/window/rect', { width: 1280, height: 900 });

  await execute(`
    const select = document.querySelector('#preset-select');
    select.value = 'timeline-pulse';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#preset-load').click();
  `);
  await sleep(250);
  const loaded = await snapshot();
  if (loaded.presetId !== 'timeline-pulse' || !loaded.presetHash || loaded.canonicalHash !== loaded.presetHash || !loaded.presetStatus.includes('Loaded Timeline Pulse')) throw new Error(`Preset adoption did not publish a stable canonical identity: ${JSON.stringify(loaded)}`);

  const beforeStamp = loaded.canonicalHash;
  await execute(`
    document.querySelector('#tool-paint').click();
    const canvas = document.querySelector('#preview-canvas');
    canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  `);
  await sleep(250);
  const afterStamp = await snapshot();
  if (!afterStamp.canonicalHash || afterStamp.canonicalHash === beforeStamp) throw new Error('Keyboard canvas stamp did not perform a canonical authoring edit.');

  // Exhibit exactly the accepted recipe, not the edited working canvas or WebGL pixels.
  await execute(`
    document.querySelector('[data-exhibition-id="first-weave"]').click();
    document.querySelector('#exhibition-render').click();
  `);
  let exhibition = null;
  const exhibitionDeadline = Date.now() + 15_000;
  while (Date.now() < exhibitionDeadline) {
    exhibition = await execute(`
      const root = document.documentElement;
      return {
        selected: root.dataset.fieldweaverPresetId,
        hash: root.dataset.fieldweaverExhibitionProofHash ?? '',
        imageReady: !document.querySelector('#exhibition-preview').hidden,
        pngEnabled: !document.querySelector('#exhibition-download-png').disabled,
        status: document.querySelector('#preset-status').textContent
      };
    `);
    if (exhibition.hash || exhibition.status.includes('failed')) break;
    await sleep(200);
  }
  if (exhibition?.selected !== 'first-weave' || exhibition.hash !== '8d83d52e732a5825' || !exhibition.imageReady || !exhibition.pngEnabled) {
    throw new Error(`Exhibition did not render canonical golden PNG: ${JSON.stringify(exhibition)}`);
  }

  const pinned = await execute(`
    document.querySelector('#exhibition-pin-a').click();
    return {
      aVisible: !document.querySelector('#exhibition-compare-a-image').hidden,
      bVisible: !document.querySelector('#exhibition-compare-b-image').hidden,
      aDetails: document.querySelector('#exhibition-compare-a-details').textContent,
      canDownloadA: !document.querySelector('#exhibition-a-download-png').disabled,
      aSource: document.querySelector('#exhibition-compare-a-image').getAttribute('src')
    };
  `);
  if (!pinned.aVisible || !pinned.bVisible || !pinned.canDownloadA ||
      !pinned.aDetails.includes('8d83d52e732a5825') || !pinned.aSource?.startsWith('blob:')) {
    throw new Error(`Pinned A did not preserve a real canonical PNG: ${JSON.stringify(pinned)}`);
  }
  const moved = await execute(`
    document.querySelector('#exhibition-next').click();
    return {
      selected: document.documentElement.dataset.fieldweaverPresetId,
      hash: document.documentElement.dataset.fieldweaverExhibitionProofHash,
      pngDisabled: document.querySelector('#exhibition-download-png').disabled,
      pressed: [...document.querySelectorAll('.exhibition-card[aria-pressed="true"]')].map((node) => node.dataset.exhibitionId),
      aVisible: !document.querySelector('#exhibition-compare-a-image').hidden,
      bHidden: document.querySelector('#exhibition-compare-b-image').hidden,
      aSource: document.querySelector('#exhibition-compare-a-image').getAttribute('src')
    };
  `);
  if (moved.selected !== 'operator-atlas' || moved.hash || !moved.pngDisabled || moved.pressed.join(',') !== 'operator-atlas' || !moved.aVisible || !moved.bHidden || moved.aSource !== pinned.aSource) {
    throw new Error(`Exhibition navigation retained stale canonical proof: ${JSON.stringify(moved)}`);
  }


  // B has its own accepted seed/tick/crop and is independently CPU-rendered.
  await execute(`document.querySelector('#exhibition-render').click();`);
  let compared;
  const compareDeadline = Date.now() + 15_000;
  while (Date.now() < compareDeadline) {
    compared = await execute(`
      return {
        selected: document.documentElement.dataset.fieldweaverPresetId,
        hash: document.documentElement.dataset.fieldweaverExhibitionProofHash,
        aVisible: !document.querySelector('#exhibition-compare-a-image').hidden,
        bVisible: !document.querySelector('#exhibition-compare-b-image').hidden,
        aDetails: document.querySelector('#exhibition-compare-a-details').textContent,
        bDetails: document.querySelector('#exhibition-compare-b-details').textContent,
        comparisonStatus: document.querySelector('#exhibition-compare-status').textContent,
        aSource: document.querySelector('#exhibition-compare-a-image').getAttribute('src'),
        bSource: document.querySelector('#exhibition-compare-b-image').getAttribute('src')
      };
    `);
    if (compared.hash || compared.comparisonStatus.includes('failed')) break;
    await sleep(200);
  }
  if (compared?.selected !== 'operator-atlas' || !compared.hash || compared.hash === exhibition.hash ||
      !compared.aVisible || !compared.bVisible || compared.aSource !== pinned.aSource ||
      !compared.bDetails.includes(compared.hash) ||
      !compared.comparisonStatus.includes('Distinct raw RGBA8 identities') ||
      compared.aSource === compared.bSource) {
    throw new Error(`Two-up canonical comparison failed: ${JSON.stringify(compared)}`);
  }

  // A rendered hash is not proof the browser actually decoded/displayed the PNG.
  // The gallery uses Blob object URLs, so exercise the restrictive CSP boundary.
  let decoded = null;
  const decodeDeadline = Date.now() + 15_000;
  while (Date.now() < decodeDeadline) {
    decoded = await execute(`
      const dimensions = (selector) => {
        const image = document.querySelector(selector);
        return [image.naturalWidth, image.naturalHeight, image.complete];
      };
      return {
        main: dimensions('#exhibition-preview'),
        a: dimensions('#exhibition-compare-a-image'),
        b: dimensions('#exhibition-compare-b-image')
      };
    `);
    if ([decoded.main, decoded.a, decoded.b].every((v) => v[0] === 96 && v[1] === 64 && v[2])) break;
    await sleep(150);
  }
  if (![decoded?.main, decoded?.a, decoded?.b].every((v) => v?.[0] === 96 && v?.[1] === 64 && v?.[2])) {
    throw new Error(`Canonical proof images were not actually decoded: ${JSON.stringify(decoded)}`);
  }
  await request('POST', `/session/${sessionId}/window/rect`, { width: 1280, height: 900 });
  await execute(`document.querySelector('#exhibition-compare-b-image').scrollIntoView({ block: 'center' });`);
  const capture = await request('GET', `/session/${sessionId}/screenshot`);
  if (!capture?.value) throw new Error('Browser did not return an exhibition comparison screenshot.');
  await writeFile(`release-exhibition-${browser}.png`, Buffer.from(capture.value, 'base64'));


  // Exercise the actual native modal, both decoded CPU images and CSS-only pixel zoom.
  await execute(`document.querySelector('#exhibition-inspect').click();`);
  let inspected = null;
  for (let i = 0; i < 80; i += 1) {
    inspected = await execute(`
      const dialog = document.querySelector('#exhibition-inspector');
      const images = [...dialog.querySelectorAll('.exhibition-inspector-frame img')];
      const scale = document.querySelector('#exhibition-inspector-zoom');
      scale.value = '4';
      scale.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        open: dialog.open,
        a: [images[0].naturalWidth, images[0].naturalHeight, images[0].complete, images[0].style.width],
        b: [images[1].naturalWidth, images[1].naturalHeight, images[1].complete, images[1].style.width],
        captions: [...dialog.querySelectorAll('figcaption')].map((n) => n.textContent),
        urls: images.map((n) => n.getAttribute('src'))
      };
    `);
    if (inspected.open && inspected.a[0] === 96 && inspected.b[0] === 96 &&
        inspected.a[2] && inspected.b[2]) break;
    await sleep(150);
  }
  if (!inspected?.open ||
      inspected.a.join(',') !== '96,64,true,384px' ||
      inspected.b.join(',') !== '96,64,true,384px' ||
      !inspected.captions[0].includes(exhibition.hash) ||
      !inspected.captions[1].includes(compared.hash) ||
      inspected.urls[0] !== compared.aSource || inspected.urls[1] !== compared.bSource) {
    throw new Error(`Full-window canonical inspection failed: ${JSON.stringify(inspected)}`);
  }
  const inspectorCapture = await request('GET', `/session/${sessionId}/screenshot`);
  if (!inspectorCapture?.value) throw new Error('Browser did not return an inspection screenshot.');
  await writeFile(`release-exhibition-inspector-${browser}.png`, Buffer.from(inspectorCapture.value, 'base64'));
  const inspectionClosed = await execute(`
    document.querySelector('#exhibition-inspector-close').click();
    const dialog = document.querySelector('#exhibition-inspector');
    return !dialog.open && [...dialog.querySelectorAll('img')].every((img) => !img.hasAttribute('src'));
  `);
  if (!inspectionClosed) throw new Error('Inspector did not release its stale image references on close.');

  const invalidated = await execute(`
    document.querySelector('#exhibition-next').click();
    return {
      aVisible: !document.querySelector('#exhibition-compare-a-image').hidden,
      bHidden: document.querySelector('#exhibition-compare-b-image').hidden,
      bDownloadDisabled: document.querySelector('#exhibition-download-png').disabled,
      aDownloadEnabled: !document.querySelector('#exhibition-a-download-png').disabled
    };
  `);
  if (!invalidated.aVisible || !invalidated.bHidden || !invalidated.bDownloadDisabled || !invalidated.aDownloadEnabled) {
    throw new Error(`Selection invalidated the pinned A or retained stale B: ${JSON.stringify(invalidated)}`);
  }
  const cleared = await execute(`
    document.querySelector('#exhibition-clear-a').click();
    return {
      aHidden: document.querySelector('#exhibition-compare-a-image').hidden,
      bHidden: document.querySelector('#exhibition-compare-b-image').hidden,
      pinDownloadDisabled: document.querySelector('#exhibition-a-download-png').disabled
    };
  `);
  if (!cleared.aHidden || !cleared.bHidden || !cleared.pinDownloadDisabled) {
    throw new Error(`Clearing A retained stale comparison artifacts: ${JSON.stringify(cleared)}`);
  }

  // Reimport the file saved by the browser through the ordinary editor file input.
  await execute("const f=document.getElementById('recipe-file');f.hidden=false;f.style.display='block'");
  const located = await request('POST', `/session/${sessionId}/element`,
    { using: 'css selector', value: '#recipe-file' });
  const inputId = located?.value?.['element-6066-11e4-a52e-4f735466cecf'];
  if (!inputId) throw new Error('Recipe upload input could not be located.');
  await request('POST', `/session/${sessionId}/element/${inputId}/value`, { text: savedPath });
  let reimport = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    reimport = await execute("return {status:document.querySelector('#recipe-status').textContent,hash:document.documentElement.dataset.fieldweaverCanonicalRecipeHash}");
    if (reimport.status.startsWith('Loaded ') || reimport.status.startsWith('Load rejected')) break;
    await sleep(100);
  }
  if (reimport?.status !== 'Loaded ' + accepted.recipeHash || reimport.hash !== accepted.recipeHash) {
    throw new Error('Browser-saved gallery recipe did not reimport exactly: ' + JSON.stringify(reimport));
  }
  const evidence = { browser, initial, recipeHandoff: { filename, recipeHash: accepted.recipeHash,
    actualSavedFile: true, keyboardEnter: true, editorPreserved: true, reimport },
    loaded, afterStamp, exhibition, pinned, moved, compared, decoded, inspected, invalidated, cleared, driverLog: driverLog.slice(-3000) };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ browser, preset: loaded.presetId, presetHash: loaded.presetHash, keyboardStampHash: afterStamp.canonicalHash, releaseDiagnostics: afterStamp.releaseDiagnostics }, null, 2));
} finally {
  if (sessionId) {
    try { await request('DELETE', `/session/${sessionId}`); } catch { /* driver cleanup only */ }
  }
  driver.kill('SIGTERM');
}
