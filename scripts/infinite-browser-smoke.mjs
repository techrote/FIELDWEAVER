import { spawn, spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const browser = process.argv[2];
if (!['chrome', 'firefox'].includes(browser)) throw new Error('Usage: node scripts/infinite-browser-smoke.mjs <chrome|firefox>');

const driverName = browser === 'chrome' ? 'chromedriver' : 'geckodriver';
const port = browser === 'chrome' ? 9515 : 4444;
const baseUrl = `http://127.0.0.1:${port}`;
const appUrl = process.env.FIELDWEAVER_SMOKE_URL ?? 'http://127.0.0.1:4173/';
const evidencePath = `infinite-smoke-${browser}.log`;

function commandPath(name) {
  const result = spawnSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

const driverPath = commandPath(driverName);
if (!driverPath) throw new Error(`${driverName} is not available on PATH; Infinite Plate browser smoke cannot be claimed.`);
const driverArgs = browser === 'chrome' ? [`--port=${port}`] : ['--port', String(port)];
const driver = spawn(driverPath, driverArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
let driverLog = '';
driver.stdout.on('data', (chunk) => { driverLog += chunk.toString(); });
driver.stderr.on('data', (chunk) => { driverLog += chunk.toString(); });

async function sleep(ms) { await new Promise((resolve) => setTimeout(resolve, ms)); }

async function request(method, path, body = undefined) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  if (text) payload = JSON.parse(text);
  if (!response.ok) throw new Error(`${method} ${path} failed ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function waitForDriver() {
  const deadline = Date.now() + 15_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const payload = await request('GET', '/status');
      if (payload?.value?.ready !== false) return;
    } catch (error) { lastError = error; }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${driverName}: ${lastError?.message ?? 'no status response'}\n${driverLog}`);
}

function capabilities() {
  if (browser === 'chrome') {
    return { capabilities: { alwaysMatch: { browserName: 'chrome', 'goog:chromeOptions': { args: [
      '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader'
    ] } } } };
  }
  const args = process.env.DISPLAY ? [] : ['-headless'];
  return { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { args, prefs: {
    'webgl.disabled': false, 'webgl.force-enabled': true, 'gfx.webrender.all': true, 'gfx.webrender.software': true
  } } } } };
}

let sessionId = null;
try {
  await waitForDriver();
  const created = await request('POST', '/session', capabilities());
  sessionId = created?.value?.sessionId ?? created?.sessionId;
  if (!sessionId) throw new Error(`WebDriver did not return a session ID: ${JSON.stringify(created)}`);
  const browserCapabilities = created?.value?.capabilities ?? created?.value ?? {};
  await request('POST', `/session/${sessionId}/window/rect`, { width: 1440, height: 1000, x: 0, y: 0 });
  await request('POST', `/session/${sessionId}/url`, { url: appUrl });
  const execute = async (script, args = []) => (await request('POST', `/session/${sessionId}/execute/sync`, { script, args }))?.value;

  const snapshotScript = `
    const panel = document.querySelector('.infinite-plate-panel');
    const controls = [...document.querySelectorAll('.infinite-plate-panel button, .infinite-plate-panel input')];
    const number = (selector) => Number(document.querySelector(selector)?.value ?? NaN);
    return {
      rendererState: document.documentElement.dataset.fieldweaverRendererState ?? '',
      editorState: document.documentElement.dataset.fieldweaverEditorState ?? '',
      infiniteState: document.documentElement.dataset.fieldweaverInfiniteState ?? '',
      ready: panel?.dataset.ready ?? '',
      recipeHash: document.documentElement.dataset.fieldweaverCanonicalRecipeHash ?? '',
      rawHash: document.documentElement.dataset.fieldweaverInfiniteRawHash ?? '',
      domainHash: document.documentElement.dataset.fieldweaverInfiniteDomainHash ?? '',
      stateHash: document.documentElement.dataset.fieldweaverInfiniteStateHash ?? '',
      depositionHash: document.documentElement.dataset.fieldweaverInfiniteDepositionHash ?? '',
      chunks: Number(document.documentElement.dataset.fieldweaverInfiniteChunks ?? -1),
      cacheHit: document.documentElement.dataset.fieldweaverInfiniteCacheHit ?? '',
      cacheSize: Number(document.documentElement.dataset.fieldweaverInfiniteCacheSize ?? -1),
      status: document.querySelector('#plate-status')?.textContent ?? '',
      hashText: document.querySelector('#plate-rgba-hash')?.textContent ?? '',
      diagnostics: [...document.querySelectorAll('#plate-diagnostics li')].map((node) => node.textContent ?? ''),
      centerChunkX: number('#plate-center-chunk-x'),
      centerChunkY: number('#plate-center-chunk-y'),
      centerLocalX: number('#plate-center-local-x'),
      centerLocalY: number('#plate-center-local-y'),
      width: number('#plate-width'),
      height: number('#plate-height'),
      exportCenterChunkX: number('#export-center-chunk-x'),
      exportCenterChunkY: number('#export-center-chunk-y'),
      exportWidth: number('#export-width'),
      exportHeight: number('#export-height'),
      exportHash: document.documentElement.dataset.fieldweaverCanonicalExportHash ?? '',
      pngDisabled: document.querySelector('#plate-download-png')?.disabled ?? true,
      provenanceDisabled: document.querySelector('#plate-download-provenance')?.disabled ?? true,
      controlCount: controls.length,
      unlabeledControls: controls.filter((node) => {
        if (node.tagName === 'BUTTON') return !(node.textContent ?? '').trim() && !node.getAttribute('aria-label');
        return !(node.closest('label') || node.getAttribute('aria-label'));
      }).length
    };
  `;

  const readyDeadline = Date.now() + 20_000;
  let initial = null;
  while (Date.now() < readyDeadline) {
    initial = await execute(snapshotScript);
    if (initial?.rendererState === 'ready' && initial?.editorState === 'ready' && initial?.ready === 'true' && initial?.infiniteState === 'ready') break;
    await sleep(200);
  }
  if (!initial || initial.ready !== 'true' || initial.infiniteState !== 'ready') {
    throw new Error(`Infinite Plate UI did not become ready: ${JSON.stringify(initial)}`);
  }
  if (!initial.recipeHash || initial.controlCount < 16 || initial.unlabeledControls !== 0) {
    throw new Error(`Infinite Plate controls are incomplete or unlabeled: ${JSON.stringify(initial)}`);
  }

  const initialRecipeHash = initial.recipeHash;
  await execute(`
    for (let index = 0; index < 220; index += 1) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    }
  `);
  await sleep(200);
  const afterPan = await execute(snapshotScript);
  if (afterPan.recipeHash !== initialRecipeHash) {
    throw new Error(`Panning mutated canonical recipe identity: ${initialRecipeHash} -> ${afterPan.recipeHash}`);
  }

  await execute(`document.querySelector('#plate-frame-view').click();`);
  await sleep(100);
  const framed = await execute(snapshotScript);
  if (Math.abs(framed.centerChunkX) < 2) {
    throw new Error(`Frame-current-view did not preserve far chunk coordinates: ${JSON.stringify(framed)}`);
  }
  if (framed.centerChunkX !== framed.exportCenterChunkX || framed.centerChunkY !== framed.exportCenterChunkY || framed.width !== framed.exportWidth || framed.height !== framed.exportHeight) {
    throw new Error(`Frame-current-view did not synchronize FW-012 export crop: ${JSON.stringify(framed)}`);
  }
  if (framed.recipeHash !== initialRecipeHash) throw new Error('Framing the camera mutated recipe identity.');

  await execute(`
    document.querySelector('#emitter-add').click();
    const setValue = (selector, value) => {
      const node = document.querySelector(selector);
      node.value = String(value);
      node.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setValue('#plate-width', 64);
    setValue('#plate-height', 48);
    setValue('#plate-tick', 12);
    setValue('#plate-units-per-pixel-q16', 65536);
    setValue('#plate-cache-chunks', 8);
    document.querySelector('#plate-evaluate').click();
  `);

  const evaluationDeadline = Date.now() + 25_000;
  let first = null;
  while (Date.now() < evaluationDeadline) {
    first = await execute(snapshotScript);
    if (first?.infiniteState === 'ready' && /^[0-9a-f]{16}$/.test(first?.rawHash ?? '') && first?.hashText === first?.rawHash) break;
    if (first?.infiniteState === 'error') break;
    await sleep(100);
  }
  if (!first || first.infiniteState !== 'ready' || !/^[0-9a-f]{16}$/.test(first.rawHash)) {
    throw new Error(`Infinite Plate evaluation did not complete: ${JSON.stringify(first)}`);
  }
  if (!/^[0-9a-f]{16}$/.test(first.domainHash) || !/^[0-9a-f]{16}$/.test(first.stateHash) || !/^[0-9a-f]{16}$/.test(first.depositionHash)) {
    throw new Error(`Infinite Plate canonical identities are incomplete: ${JSON.stringify(first)}`);
  }
  if (first.pngDisabled || first.provenanceDisabled || first.chunks < 1 || !first.diagnostics.some((line) => line.includes('FW-012 software raster/PNG'))) {
    throw new Error(`Infinite Plate export/diagnostic evidence is incomplete: ${JSON.stringify(first)}`);
  }

  const stable = { rawHash: first.rawHash, domainHash: first.domainHash, stateHash: first.stateHash, depositionHash: first.depositionHash };
  await execute(`
    for (let index = 0; index < 80; index += 1) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    }
    const cache = document.querySelector('#plate-cache-chunks');
    cache.value = '1';
    cache.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#plate-clear-cache').click();
    document.querySelector('#plate-evaluate').click();
  `);

  const repeatDeadline = Date.now() + 25_000;
  let repeated = null;
  while (Date.now() < repeatDeadline) {
    repeated = await execute(snapshotScript);
    if (repeated?.infiniteState === 'ready' && repeated?.rawHash === stable.rawHash) break;
    if (repeated?.infiniteState === 'error') break;
    await sleep(100);
  }
  if (!repeated || repeated.rawHash !== stable.rawHash || repeated.domainHash !== stable.domainHash || repeated.stateHash !== stable.stateHash || repeated.depositionHash !== stable.depositionHash) {
    throw new Error(`Camera/cache history changed canonical regional identities: ${JSON.stringify({ stable, repeated })}`);
  }

  await execute(`document.querySelector('#export-prepare').click();`);
  const exportDeadline = Date.now() + 25_000;
  let fw012 = null;
  while (Date.now() < exportDeadline) {
    fw012 = await execute(snapshotScript);
    if (/^[0-9a-f]{16}$/.test(fw012?.exportHash ?? '')) break;
    await sleep(100);
  }
  if (!fw012 || fw012.exportHash !== stable.rawHash) {
    throw new Error(`FW-012 export disagrees with Infinite Plate crop: ${stable.rawHash} -> ${fw012?.exportHash}`);
  }

  const evidence = {
    browser,
    browserVersion: browserCapabilities.browserVersion ?? browserCapabilities.version ?? 'unknown',
    initialRecipeHash,
    farChunk: [framed.centerChunkX, framed.centerChunkY],
    evaluatedRecipeHash: first.recipeHash,
    rawRgbaHash: stable.rawHash,
    domainHash: stable.domainHash,
    stateHash: stable.stateHash,
    regionalDepositionHash: stable.depositionHash,
    requestedChunks: first.chunks,
    repeatedAfterCameraAndEviction: {
      rawRgbaHash: repeated.rawHash,
      domainHash: repeated.domainHash,
      stateHash: repeated.stateHash,
      regionalDepositionHash: repeated.depositionHash,
      cacheSize: repeated.cacheSize
    },
    fw012RawRgbaHash: fw012.exportHash
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n\n--- WebDriver log ---\n${driverLog}`);
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  const failureText = `${error?.stack ?? error}\n\n--- WebDriver log ---\n${driverLog}`;
  await writeFile(evidencePath, failureText);
  console.error(failureText);
  throw error;
} finally {
  if (sessionId) { try { await request('DELETE', `/session/${sessionId}`); } catch { /* teardown must not hide primary result */ } }
  driver.kill('SIGTERM');
}
