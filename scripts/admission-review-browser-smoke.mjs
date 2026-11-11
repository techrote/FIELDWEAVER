// Real file:// Chrome + Firefox proof for the single source-exact admission board.
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const browser = process.argv[2], input = resolve(process.argv[3] || 'admission-review.html');
if (!['chrome', 'firefox'].includes(browser)) throw new Error('Expected chrome or firefox.');
const driverCommand = browser === 'chrome' ? 'chromedriver' : 'geckodriver';
if (spawnSync('bash', ['-lc', 'command -v ' + driverCommand], { encoding: 'utf8' }).status !== 0)
  throw new Error('Real browser WebDriver missing: ' + driverCommand);
await readFile(input);
const port = browser === 'chrome' ? 9695 : 9696;
const driver = spawn(driverCommand, browser === 'chrome' ? ['--port=' + port] : ['--port', String(port)],
  { stdio: ['ignore', 'pipe', 'pipe'] });
let driverLog = '';
for (const stream of [driver.stdout, driver.stderr]) stream.on('data', (chunk) => { driverLog += String(chunk); });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function request(method, path, payload) {
  const response = await fetch('http://127.0.0.1:' + port + path, {
    method, headers: payload === undefined ? undefined : { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || data?.value?.error) throw new Error(method + ' ' + path + ': ' + JSON.stringify(data).slice(0, 600));
  return data.value;
}
let sessionId;
try {
  let available = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { await request('GET', '/status'); available = true; break; }
    catch { await sleep(150); }
  }
  if (!available) throw new Error('WebDriver unavailable: ' + driverLog);
  const capabilities = browser === 'chrome'
    ? { browserName: 'chrome', 'goog:chromeOptions': { args: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage'] } }
    : { browserName: 'firefox', 'moz:firefoxOptions': { args: ['-headless'] } };
  const created = await request('POST', '/session', { capabilities: { alwaysMatch: capabilities } });
  sessionId = created.sessionId;
  if (!sessionId) throw new Error('WebDriver did not create a session.');
  const base = '/session/' + sessionId;
  await request('POST', base + '/window/rect', { width: 1440, height: 900 });
  await request('POST', base + '/url', { url: pathToFileURL(input).href });
  const execute = (script) => request('POST', base + '/execute/sync', { script, args: [] });
  await execute("for (const img of document.querySelectorAll('article.work img')) img.loading='eager'");
  let desktop;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    desktop = await execute("return {title:document.title,cards:document.querySelectorAll('article.work').length,labels:[...document.querySelectorAll('article.work .state')].map(n=>n.textContent.trim()),images:[...document.querySelectorAll('article.work img')].map(i=>({complete:i.complete,w:i.naturalWidth,h:i.naturalHeight,data:i.src.startsWith('data:image/png;base64,')})),scripts:document.querySelectorAll('script').length,csp:document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]')?.content??'',remote:performance.getEntriesByType('resource').filter(r=>/^https?:/.test(r.name)).length}");
    if (desktop.images.every((img) => img.complete && img.w && img.h)) break;
    await sleep(100);
  }
  const expected = ['ACCEPTED PRESET', 'ACCEPTED PRESET', 'UNMERGED CANDIDATE',
    'UNMERGED CANDIDATE', 'UNMERGED CANDIDATE', 'UNMERGED CANDIDATE'];
  if (desktop.cards !== 6 || JSON.stringify(desktop.labels) !== JSON.stringify(expected) ||
      desktop.scripts !== 0 || !desktop.csp.includes("default-src 'none'") ||
      desktop.remote !== 0 || desktop.images.length !== 6 ||
      desktop.images.some((img) => !img.complete || !img.data || !img.w || !img.h)) {
    throw new Error('Offline canonical admission HTML was not verified: ' + JSON.stringify(desktop));
  }
  const screenshot = await request('GET', base + '/screenshot');
  await writeFile('admission-review-' + browser + '-desktop.png', Buffer.from(screenshot, 'base64'));
  const found = await request('POST', base + '/elements',
    { using: 'css selector', value: 'nav[aria-label="Jump to artwork"] a' });
  if (found.length !== 6) throw new Error('Offline gallery navigation has wrong anchor count.');
  const anchor = found[3]['element-6066-11e4-a52e-4f735466cecf'] || found[3].ELEMENT;
  await request('POST', base + '/element/' + anchor + '/value', { text: '\uE007' });
  const hash = await execute('return window.location.hash');
  if (hash !== '#work-4') throw new Error('Keyboard navigation failed: ' + hash);
  await request('POST', base + '/window/rect', { width: 390, height: 844 });
  await sleep(150);
  const narrow = await execute("return {width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,cards:document.querySelectorAll('article.work').length,label:document.querySelector('#work-4 .state')?.textContent.trim()}");
  if (narrow.cards !== 6 || narrow.label !== 'UNMERGED CANDIDATE' ||
      narrow.scrollWidth > narrow.width + 2) throw new Error('Narrow-layout failure: ' + JSON.stringify(narrow));
  const mobile = await request('GET', base + '/screenshot');
  await writeFile('admission-review-' + browser + '-narrow.png', Buffer.from(mobile, 'base64'));
  const receipt = { browser, input, desktop, keyboardHash: hash, narrow };
  await writeFile('admission-review-' + browser + '.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  if (sessionId) { try { await request('DELETE', '/session/' + sessionId); } catch {} }
  driver.kill('SIGTERM');
}
