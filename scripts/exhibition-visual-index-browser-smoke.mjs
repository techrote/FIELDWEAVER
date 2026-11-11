import { spawn, spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

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
  await request('POST', '/session/' + sessionId + '/window/rect', { width: 1250, height: 900 });
  await execute("document.querySelector('#exhibition-grid').scrollIntoView({block:'center'})");
  const screenshot = await request('GET', '/session/' + sessionId + '/screenshot');
  if (!screenshot?.value) throw new Error('Browser screenshot absent.');
  await writeFile('exhibition-visual-index-' + browser + '.png', Buffer.from(screenshot.value, 'base64'));
  await writeFile('exhibition-visual-index-' + browser + '.json', JSON.stringify({ browser, initial, result, selected }, null, 2) + '\n');
  console.log(JSON.stringify({ browser, status:'four actual decoded canonical CPU images', hashes:result.tiles.map((tile) => tile.hash), selected:selected.id }, null, 2));
} finally {
  if (sessionId) { try { await request('DELETE', '/session/' + sessionId); } catch { /* cleanup */ } }
  driver.kill('SIGTERM');
}
