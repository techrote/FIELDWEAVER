import { spawn, spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

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

  const evidence = { browser, initial, loaded, afterStamp, driverLog: driverLog.slice(-3000) };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ browser, preset: loaded.presetId, presetHash: loaded.presetHash, keyboardStampHash: afterStamp.canonicalHash, releaseDiagnostics: afterStamp.releaseDiagnostics }, null, 2));
} finally {
  if (sessionId) {
    try { await request('DELETE', `/session/${sessionId}`); } catch { /* driver cleanup only */ }
  }
  driver.kill('SIGTERM');
}
