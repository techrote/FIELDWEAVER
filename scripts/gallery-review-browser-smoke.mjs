// Browser-level acceptance for the opt-in, fully offline canonical review page.
// Open a real file:// document; source-only HTML tests are not browser evidence.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runCli } from './review-gallery.mjs';

const browser = process.argv[2];
if (!['chrome', 'firefox'].includes(browser)) {
  throw new Error('Usage: node scripts/gallery-review-browser-smoke.mjs <chrome|firefox>');
}
const driverName = browser === 'chrome' ? 'chromedriver' : 'geckodriver';
const port = browser === 'chrome' ? 9520 : 4449;
const base = 'http://127.0.0.1:' + port;
const located = spawnSync('bash', ['-lc', 'command -v ' + driverName], { encoding: 'utf8' });
if (located.status !== 0) throw new Error(driverName + ' unavailable; cannot claim browser qualification.');

const driver = spawn(located.stdout.trim(), browser === 'chrome' ?
  ['--port=' + port] : ['--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
let driverLog = '';
driver.stdout.on('data', (chunk) => { driverLog += chunk.toString(); });
driver.stderr.on('data', (chunk) => { driverLog += chunk.toString(); });
const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

async function request(method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const content = await response.text();
  const payload = content ? JSON.parse(content) : null;
  if (!response.ok) throw new Error(method + ' ' + path + ' failed: ' + content.slice(0, 800));
  return payload;
}

async function waitForDriver() {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    try { if ((await request('GET', '/status'))?.value?.ready !== false) return; } catch { /* retry */ }
    await sleep(150);
  }
  throw new Error('Browser driver did not start: ' + driverLog);
}

function capabilities() {
  if (browser === 'chrome') {
    return { capabilities: { alwaysMatch: { browserName: 'chrome',
      'goog:chromeOptions': { args: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage'] } } } };
  }
  return { capabilities: { alwaysMatch: { browserName: 'firefox',
    'moz:firefoxOptions': { args: process.env.DISPLAY ? [] : ['-headless'] } } } };
}

let sessionId = null;
let directory = null;
try {
  directory = await mkdtemp(join(tmpdir(), 'fw-gallery-browser-'));
  const page = join(directory, 'canonical-review.html');
  const generated = await runCli(['--out', page, '--preset', 'first-weave', '--preset', 'operator-atlas']);
  if (generated.entries.length !== 2) throw new Error('Review generation did not produce two proofs.');

  await waitForDriver();
  const response = await request('POST', '/session', capabilities());
  sessionId = response?.value?.sessionId ?? response?.sessionId;
  if (!sessionId) throw new Error('WebDriver session unavailable.');
  const url = pathToFileURL(page).href;
  await request('POST', '/session/' + sessionId + '/url', { url });

  // A file:// navigation can finish before Firefox decodes embedded PNG data.
  // Wait for real intrinsic dimensions; complete=true alone also describes a
  // broken image. Never relax the following canonical/offline assertions.
  const readinessScript = [
    'return [...document.querySelectorAll(".work figure img")].map((img) => ({',
    '  complete: img.complete, width: img.naturalWidth, height: img.naturalHeight,',
    '  data: img.currentSrc.startsWith("data:image/png;base64,")',
    '}));'
  ].join('\n');
  let imageReadiness = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    imageReadiness = (await request('POST', '/session/' + sessionId + '/execute/sync',
      { script: readinessScript, args: [] }))?.value ?? [];
    if (imageReadiness.length === generated.entries.length &&
        imageReadiness.every((image) => image.complete && image.width > 0 &&
          image.height > 0 && image.data)) break;
    await sleep(100);
  }
  if (imageReadiness.length !== generated.entries.length ||
      imageReadiness.some((image) => !image.complete || image.width <= 0 ||
        image.height <= 0 || !image.data)) {
    throw new Error('Offline canonical PNGs failed to decode in browser: ' + JSON.stringify(imageReadiness));
  }

  const evaluation = [
    'const cards = [...document.querySelectorAll(".work")];',
    'const images = [...document.querySelectorAll(".work figure img")];',
    'const firstDetails = document.querySelector(".work details");',
    'firstDetails.querySelector("summary").click();',
    'const opened = firstDetails.open;',
    'document.querySelector("nav a[href=\\"#work-2\\"]").click();',
    'const source = document.documentElement.outerHTML;',
    'return {',
    '  title: document.title, url: location.href, cards: cards.length,',
    '  labels: cards.map((card) => card.querySelector(".state")?.textContent),',
    '  images: images.map((img) => ({ complete: img.complete, width: img.naturalWidth,',
    '    height: img.naturalHeight, data: img.currentSrc.startsWith("data:image/png;base64,") })),',
    '  detailOpen: opened, target: location.hash,',
    '  downloadable: document.querySelectorAll(".actions a[download]").length,',
    '  styleGrid: getComputedStyle(document.querySelector(".grid")).display,',
    '  forbiddenExternalResources: [...document.querySelectorAll("[src],[href]")].some((node) =>',
    '    /^https?:/i.test(node.getAttribute("src") || node.getAttribute("href") || "")),',
    '  embeddedScripts: document.querySelectorAll("script,iframe").length,',
    '  hasCsp: source.includes("Content-Security-Policy")',
    '};'
  ].join('\n');
  const observed = (await request('POST', '/session/' + sessionId + '/execute/sync',
    { script: evaluation, args: [] }))?.value;
  // Firefox schedules same-document hash navigation after the synchronous
  // WebDriver script returns. Poll the observable URL, not the click stack.
  for (let attempt = 0; observed?.target !== '#work-2' && attempt < 20; attempt += 1) {
    await sleep(100);
    observed.target = (await request('POST', '/session/' + sessionId + '/execute/sync',
      { script: 'return location.hash;', args: [] }))?.value;
  }
  if (observed.cards !== 2 ||
      observed.labels.join('|') !== 'ACCEPTED PRESET|ACCEPTED PRESET' ||
      observed.images.some((item) => !item.complete || !item.data || item.width <= 0 || item.height <= 0) ||
      !observed.detailOpen || observed.target !== '#work-2' ||
      observed.downloadable !== 6 || observed.styleGrid !== 'grid' ||
      observed.forbiddenExternalResources || observed.embeddedScripts || !observed.hasCsp) {
    throw new Error('Offline gallery browser acceptance failed: ' + JSON.stringify(observed));
  }
  const shot = await request('GET', '/session/' + sessionId + '/screenshot');
  await writeFile('gallery-review-smoke-' + browser + '.png', Buffer.from(shot.value, 'base64'));
  await writeFile('gallery-review-smoke-' + browser + '.log',
    JSON.stringify({ browser, generated: generated.entries, observed }, null, 2) + '\n');
  console.log(JSON.stringify({ browser, cards: observed.cards, images: observed.images,
    nativeDetails: observed.detailOpen, hashNavigation: observed.target,
    offlineFile: observed.url.startsWith('file:') }, null, 2));
} finally {
  if (sessionId) {
    try { await request('DELETE', '/session/' + sessionId); } catch { /* cleanup only */ }
  }
  driver.kill('SIGTERM');
  if (directory) await rm(directory, { recursive: true, force: true });
}
