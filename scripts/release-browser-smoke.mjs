import { spawn, spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { getBuiltinPreset } from '../src/presets/index.js';
import { parseRecipe, recipeHash, serializeRecipe } from '../src/recipe/index.js';

const browser = process.argv[2];
if (!['chrome', 'firefox'].includes(browser)) throw new Error('Usage: node scripts/release-browser-smoke.mjs <chrome|firefox>');
const driverName = browser === 'chrome' ? 'chromedriver' : 'geckodriver';
const port = browser === 'chrome' ? 9518 : 4447;
const baseUrl = `http://127.0.0.1:${port}`;
const appUrl = process.env.FIELDWEAVER_SMOKE_URL ?? 'http://127.0.0.1:4173/';
const evidencePath = `release-smoke-${browser}.log`;

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
  if (browser === 'chrome') return { capabilities: { alwaysMatch: { browserName: 'chrome', 'goog:chromeOptions': { args: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader'] } } } };
  return { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { args: process.env.DISPLAY ? [] : ['-headless'], prefs: { 'webgl.disabled': false, 'webgl.force-enabled': true, 'gfx.webrender.software': true } } } } };
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

  // Actual browser click; capture the generated local JSON Blob before the
  // browser's download manager takes over. This does NOT claim OS persistence.
  const editorBeforeHandoff = (await snapshot()).canonicalHash;
  await execute(`
    window.__fwRecipeHandoff = { filename: '', text: null };
    const originalCreate = URL.createObjectURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = function(blob) {
      if (blob.type === 'application/json') {
        void blob.text().then((text) => { window.__fwRecipeHandoff.text = text; });
      }
      return originalCreate.call(URL, blob);
    };
    HTMLAnchorElement.prototype.click = function() {
      if (this.download.endsWith('.fwrecipe.json')) {
        window.__fwRecipeHandoff.filename = this.download;
        return; // Intercept only the test's recipe file download.
      }
      return originalClick.call(this);
    };
    document.querySelector('[data-exhibition-id="first-weave"]').click();
    document.querySelector('#exhibition-download-recipe').click();
    URL.createObjectURL = originalCreate;
    HTMLAnchorElement.prototype.click = originalClick;
  `);
  let recipeHandoff;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    recipeHandoff = await execute(`
      return {
        filename: window.__fwRecipeHandoff?.filename ?? '',
        text: window.__fwRecipeHandoff?.text ?? null,
        status: document.querySelector('#preset-status').textContent,
        proofPending: document.querySelector('#exhibition-download-png').disabled
      };
    `);
    if (recipeHandoff?.text) break;
    await sleep(50);
  }
  const accepted = getBuiltinPreset('first-weave');
  if (!recipeHandoff?.text ||
      recipeHandoff.filename !== 'fieldweaver-first-weave-' + accepted.recipeHash + '.fwrecipe.json' ||
      recipeHandoff.text !== serializeRecipe(accepted.recipe) ||
      recipeHash(parseRecipe(recipeHandoff.text)) !== accepted.recipeHash ||
      !recipeHandoff.proofPending ||
      !recipeHandoff.status.includes('editor unchanged') ||
      (await snapshot()).canonicalHash !== editorBeforeHandoff) {
    throw new Error('Gallery recipe download did not preserve the importable accepted identity or live work: ' +
      JSON.stringify({ filename: recipeHandoff?.filename, status: recipeHandoff?.status, proofPending: recipeHandoff?.proofPending }));
  }
  await execute(`document.querySelector('#exhibition-download-recipe').scrollIntoView({ block: 'center' });`);
  const recipeCapture = await request('GET', `/session/${sessionId}/screenshot`);
  if (!recipeCapture?.value) throw new Error('Browser did not return gallery recipe handoff screenshot.');
  await writeFile('release-exhibition-recipe-' + browser + '.png', Buffer.from(recipeCapture.value, 'base64'));

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

  const evidence = { browser, initial, recipeHandoff: { filename: recipeHandoff.filename, recipeHash: accepted.recipeHash, browserBlobVerified: true, editorPreserved: true }, loaded, afterStamp, exhibition, pinned, moved, compared, decoded, inspected, invalidated, cleared, driverLog: driverLog.slice(-3000) };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ browser, preset: loaded.presetId, presetHash: loaded.presetHash, keyboardStampHash: afterStamp.canonicalHash, releaseDiagnostics: afterStamp.releaseDiagnostics }, null, 2));
} finally {
  if (sessionId) {
    try { await request('DELETE', `/session/${sessionId}`); } catch { /* driver cleanup only */ }
  }
  driver.kill('SIGTERM');
}
