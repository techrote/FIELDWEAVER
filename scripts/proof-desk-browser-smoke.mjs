import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFile, rm } from 'node:fs/promises';
import { createCanonicalExport } from '../src/export/index.js';
import { getBuiltinPreset } from '../src/presets/index.js';

const browser = process.argv[2];
if (!['chrome', 'firefox'].includes(browser)) {
  throw new Error('Usage: node scripts/proof-desk-browser-smoke.mjs <chrome|firefox>');
}
const driverName = browser === 'chrome' ? 'chromedriver' : 'geckodriver';
const port = browser === 'chrome' ? 9533 : 4461;
const driverUrl = 'http://127.0.0.1:' + port;
const appUrl = process.env.FIELDWEAVER_SMOKE_URL ?? 'http://127.0.0.1:4173/proof-desk.html';
const goldenFile = resolve('.proof-desk-ci-golden.fwexport.json');
const archivedFile = resolve('.proof-desk-ci-archived.png');
const forgedFile = resolve('.proof-desk-ci-forged.fwexport.json');
const logFile = 'proof-desk-smoke-' + browser + '.log';
const imageFile = 'proof-desk-smoke-' + browser + '.png';

function findCommand(name) {
  const found = spawnSync('bash', ['-lc', 'command -v ' + name], { encoding: 'utf8' });
  return found.status === 0 ? found.stdout.trim() : null;
}
const executable = findCommand(driverName);
if (!executable) throw new Error(driverName + ' unavailable; real browser acceptance cannot be claimed.');

const preset = getBuiltinPreset('first-weave');
const proof = createCanonicalExport(preset.recipe, {
  crop: preset.exportCrop, targetTick: preset.targetTick,
  agentCapacity: 4096, maxDepositions: 250_000,
  tileWidthPx: 32, tileHeightPx: 32
});
await writeFile(goldenFile, proof.provenanceJson);
await writeFile(archivedFile, proof.png);
await writeFile(forgedFile, JSON.stringify({ ...proof.provenance, rawRgbaHash: '0000000000000000' }));

const driver = spawn(executable, browser === 'chrome' ? ['--port=' + port] : ['--port', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe']
});
let driverLog = '';
driver.stdout.on('data', (data) => { driverLog += data.toString(); });
driver.stderr.on('data', (data) => { driverLog += data.toString(); });
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
async function request(method, path, body) {
  const res = await fetch(driverUrl + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await res.text();
  const result = raw ? JSON.parse(raw) : {};
  if (!res.ok) throw new Error(method + ' ' + path + ' -> ' + res.status + ': ' + raw.slice(0, 700));
  return result.value;
}
async function waitReady() {
  for (let i = 0; i < 100; i += 1) {
    try { if ((await request('GET', '/status'))?.ready !== false) return; } catch { /* starting */ }
    await sleep(150);
  }
  throw new Error('WebDriver did not become ready: ' + driverLog.slice(-1000));
}
function capabilities() {
  if (browser === 'chrome') return { capabilities: { alwaysMatch: {
    browserName: 'chrome',
    'goog:chromeOptions': { args: ['--headless=new','--no-sandbox','--disable-dev-shm-usage'] }
  } } };
  return { capabilities: { alwaysMatch: {
    browserName: 'firefox',
    'moz:firefoxOptions': { args: process.env.DISPLAY ? [] : ['-headless'] }
  } } };
}
let session;
try {
  await waitReady();
  const result = await request('POST', '/session', capabilities());
  session = result.sessionId;
  if (!session) throw new Error('WebDriver did not return session ID.');
  const root = '/session/' + session;
  await request('POST', root + '/url', { url: appUrl });
  const execute = (script) => request('POST', root + '/execute/sync', { script, args: [] });
  const find = (selector) => request('POST', root + '/element', { using: 'css selector', value: selector });
  const upload = async (selector, path) => {
    const element = await find(selector);
    const id = element['element-6066-11e4-a52e-4f735466cecf'] ?? element.ELEMENT;
    await request('POST', root + '/element/' + id + '/value', { text: path, value: [path] });
  };
  let ready = false;
  for (let i = 0; i < 50; i += 1) {
    ready = await execute("return document.documentElement.dataset.fieldweaverProofDeskState === 'ready';");
    if (ready) break;
    await sleep(100);
  }
  if (!ready) throw new Error('Proof desk module did not initialize.');
  await upload('#proof-provenance', goldenFile);
  await upload('#proof-png', archivedFile);
  await execute("document.getElementById('proof-verify').click();");
  let observed;
  for (let i = 0; i < 80; i += 1) {
    observed = await execute(`
      const img = document.getElementById('proof-image');
      return {
        state: document.documentElement.dataset.fieldweaverProofDeskState,
        hash: document.documentElement.dataset.fieldweaverProofDeskHash,
        width: img.naturalWidth, height: img.naturalHeight,
        visible: !img.hidden,
        png: document.getElementById('proof-png-status').textContent,
        caption: document.getElementById('proof-caption').textContent,
        status: document.getElementById('proof-status').textContent
      };
    `);
    if (observed.state === 'verified' && observed.width > 0 || observed.state === 'error') break;
    await sleep(250);
  }
  if (observed.state !== 'verified' || observed.hash !== '8d83d52e732a5825' ||
    observed.width !== 96 || observed.height !== 64 || !observed.visible ||
    !observed.png.includes('pixel for pixel')) {
    throw new Error('Browser did not decode a true verified canonical PNG: ' + JSON.stringify(observed));
  }
  const screenshot = await request('GET', root + '/screenshot');
  await writeFile(imageFile, Buffer.from(screenshot, 'base64'));

  await upload('#proof-provenance', forgedFile);
  const afterChange = await execute(`
    return { visible: !document.getElementById('proof-image').hidden,
      hash: document.documentElement.dataset.fieldweaverProofDeskHash,
      details: !document.getElementById('proof-details').hidden };
  `);
  if (afterChange.visible || afterChange.hash || afterChange.details) {
    throw new Error('Stale verified artwork remained after changing the source file: ' + JSON.stringify(afterChange));
  }
  await execute("document.getElementById('proof-verify').click();");
  let forged;
  for (let i = 0; i < 40; i += 1) {
    forged = await execute(`
      return { state: document.documentElement.dataset.fieldweaverProofDeskState,
        status: document.getElementById('proof-status').textContent,
        visible: !document.getElementById('proof-image').hidden };
    `);
    if (forged.state === 'error') break;
    await sleep(150);
  }
  if (forged.state !== 'error' || !forged.status.includes('rawRgbaHash') || forged.visible) {
    throw new Error('Forged provenance was not rejected visibly: ' + JSON.stringify(forged));
  }
  await writeFile(logFile, JSON.stringify({ browser, observed, afterChange, forged, screenshot: imageFile }, null, 2) + '\n');
  console.log('Proof desk browser acceptance PASS: ' + browser + ', decoded 96×64 canonical PNG; forged proof rejected.');
} finally {
  if (session) {
    try { await request('DELETE', '/session/' + session); } catch { /* cleanup */ }
  }
  driver.kill('SIGTERM');
  await Promise.all([goldenFile, archivedFile, forgedFile].map((file) => rm(file, { force: true })));
}
