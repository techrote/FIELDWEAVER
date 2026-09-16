import { spawn, spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const browser = process.argv[2];
if (!['chrome', 'firefox'].includes(browser)) throw new Error('Usage: node scripts/export-browser-smoke.mjs <chrome|firefox>');

const driverName = browser === 'chrome' ? 'chromedriver' : 'geckodriver';
const port = browser === 'chrome' ? 9515 : 4444;
const baseUrl = `http://127.0.0.1:${port}`;
const appUrl = process.env.FIELDWEAVER_SMOKE_URL ?? 'http://127.0.0.1:4173/';
const evidencePath = `export-smoke-${browser}.log`;

function commandPath(name) {
  const result = spawnSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

const driverPath = commandPath(driverName);
if (!driverPath) throw new Error(`${driverName} is not available on PATH; export browser smoke cannot be claimed.`);
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
    const panel = document.querySelector('.export-panel');
    const controls = [...document.querySelectorAll('.export-panel button, .export-panel input')];
    return {
      rendererState: document.documentElement.dataset.fieldweaverRendererState ?? '',
      editorState: document.documentElement.dataset.fieldweaverEditorState ?? '',
      exportState: document.documentElement.dataset.fieldweaverExportState ?? '',
      exportReady: panel?.dataset.ready ?? '',
      recipeHash: document.documentElement.dataset.fieldweaverCanonicalRecipeHash ?? '',
      rawHash: document.documentElement.dataset.fieldweaverCanonicalExportHash ?? '',
      exportTick: Number(document.documentElement.dataset.fieldweaverCanonicalExportTick ?? -1),
      pngBytes: Number(document.documentElement.dataset.fieldweaverCanonicalExportPngBytes ?? -1),
      depositions: Number(document.documentElement.dataset.fieldweaverCanonicalExportDepositions ?? -1),
      hashText: document.querySelector('#export-rgba-hash')?.textContent ?? '',
      status: document.querySelector('#export-status')?.textContent ?? '',
      diagnostics: [...document.querySelectorAll('#export-diagnostics li')].map((node) => node.textContent ?? ''),
      pngDisabled: document.querySelector('#export-download-png')?.disabled ?? true,
      provenanceDisabled: document.querySelector('#export-download-provenance')?.disabled ?? true,
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
    if (initial?.rendererState === 'ready' && initial?.editorState === 'ready' && initial?.exportReady === 'true' && initial?.exportState === 'ready') break;
    await sleep(200);
  }
  if (!initial || initial.exportReady !== 'true' || initial.exportState !== 'ready') {
    throw new Error(`Canonical export UI did not become ready: ${JSON.stringify(initial)}`);
  }
  if (!initial.recipeHash || initial.controlCount < 13 || initial.unlabeledControls !== 0) {
    throw new Error(`Canonical export controls are incomplete or unlabeled: ${JSON.stringify(initial)}`);
  }

  await execute(`
    const setValue = (selector, value) => {
      const node = document.querySelector(selector);
      node.value = String(value);
      node.dispatchEvent(new Event('change', { bubbles: true }));
    };
    document.querySelector('#export-use-recipe-framing').click();
    setValue('#export-width', 64);
    setValue('#export-height', 48);
    setValue('#export-tick', 12);
    setValue('#export-units-per-pixel-q16', 65536);
    setValue('#export-tile-size', 7);
    document.querySelector('#export-prepare').click();
  `);

  const exportDeadline = Date.now() + 20_000;
  let first = null;
  while (Date.now() < exportDeadline) {
    first = await execute(snapshotScript);
    if (first?.exportState === 'ready' && /^[0-9a-f]{16}$/.test(first?.rawHash ?? '') && first?.exportTick === 12) break;
    await sleep(100);
  }
  if (!first || first.exportState !== 'ready' || !/^[0-9a-f]{16}$/.test(first.rawHash) || first.exportTick !== 12) {
    throw new Error(`Canonical export did not complete: ${JSON.stringify(first)}`);
  }
  if (first.rawHash !== first.hashText || first.pngBytes <= 0 || first.depositions <= 0 || first.pngDisabled || first.provenanceDisabled) {
    throw new Error(`Canonical export package evidence is incomplete: ${JSON.stringify(first)}`);
  }
  if (!first.diagnostics.some((line) => line.includes('Canonical software raster'))) {
    throw new Error(`Export UI does not identify the canonical software path: ${JSON.stringify(first.diagnostics)}`);
  }

  const firstHash = first.rawHash;
  await execute(`
    const canvas = document.querySelector('#preview-canvas');
    canvas?.dispatchEvent(new WheelEvent('wheel', { deltaY: -180, bubbles: true, cancelable: true }));
    const tile = document.querySelector('#export-tile-size');
    tile.value = '64';
    tile.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#export-prepare').click();
  `);
  const repeatDeadline = Date.now() + 20_000;
  let repeated = null;
  while (Date.now() < repeatDeadline) {
    repeated = await execute(snapshotScript);
    if (repeated?.exportState === 'ready' && repeated?.rawHash === firstHash) break;
    await sleep(100);
  }
  if (!repeated || repeated.rawHash !== firstHash) {
    throw new Error(`Changing preview view/tile size changed canonical raw pixels: ${firstHash} -> ${repeated?.rawHash}`);
  }

  await execute(`
    const width = document.querySelector('#export-width');
    width.value = '0';
    width.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#export-prepare').click();
  `);
  await sleep(100);
  const rejected = await execute(snapshotScript);
  if (rejected.exportState !== 'error' || !rejected.status.includes('Export failed:') || !rejected.pngDisabled || !rejected.provenanceDisabled) {
    throw new Error(`Invalid canonical export did not fail explicitly: ${JSON.stringify(rejected)}`);
  }

  const evidence = {
    browser,
    browserVersion: browserCapabilities.browserVersion ?? browserCapabilities.version ?? 'unknown',
    recipeHash: first.recipeHash,
    rawRgbaHash: first.rawHash,
    targetTick: first.exportTick,
    depositionCount: first.depositions,
    pngBytes: first.pngBytes,
    canonicalDiagnostic: first.diagnostics.find((line) => line.includes('Canonical software raster')) ?? '',
    repeatedHashAfterViewAndTileChange: repeated.rawHash,
    invalidInputStatus: rejected.status
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
