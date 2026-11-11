import { spawn, spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const browser = process.argv[2] ?? 'firefox';
if (!['chrome', 'firefox'].includes(browser)) throw new Error('Expected chrome or firefox.');
const driverName = browser === 'chrome' ? 'chromedriver' : 'geckodriver';
if (spawnSync('bash', ['-lc', 'command -v ' + driverName], { encoding: 'utf8' }).status !== 0) {
  throw new Error(driverName + ' unavailable. No browser evidence may be claimed.');
}
const port = browser === 'chrome' ? 9683 : 9684;
const driver = spawn(driverName, browser === 'chrome' ? ['--port=' + port] : ['--port', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe']
});
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
  if (!response.ok || value?.value?.error) throw new Error(method + ' ' + path + ': ' + JSON.stringify(value).slice(0, 600));
  return value;
}
let sessionId = null;
try {
  let online = false;
  for (let i = 0; i < 90; i += 1) {
    try { await request('GET', '/status'); online = true; break; } catch { await sleep(150); }
  }
  if (!online) throw new Error('WebDriver unavailable: ' + driverLog);
  const desired = browser === 'chrome'
    ? { capabilities: { alwaysMatch: { browserName: 'chrome', 'goog:chromeOptions': { args: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader'] } } } }
    : { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { args: process.env.DISPLAY ? [] : ['-headless'], prefs: { 'webgl.disabled': false, 'webgl.force-enabled': true, 'gfx.webrender.software': true } } } } };
  const created = await request('POST', '/session', desired);
  sessionId = created?.value?.sessionId ?? created?.sessionId;
  if (!sessionId) throw new Error('WebDriver session absent.');
  await request('POST', '/session/' + sessionId + '/url', { url: 'http://127.0.0.1:4173/' });
  const execute = async (script) => (await request('POST', '/session/' + sessionId + '/execute/sync', { script, args: [] }))?.value;
  let mounted = false;
  for (let i = 0; i < 90; i += 1) {
    mounted = await execute("return !!document.getElementById('exhibition-recipe-ledger') && !!document.getElementById('exhibition-index-render')");
    if (mounted) break;
    await sleep(200);
  }
  if (!mounted) throw new Error('Recipe score did not mount in the actual local-first gallery.');
  const before = await execute("return document.documentElement.dataset.fieldweaverCanonicalRecipeHash");
  await execute("document.getElementById('exhibition-index-render').click()");
  let rendered;
  for (let i = 0; i < 160; i += 1) {
    rendered = await execute("return document.getElementById('exhibition-index-status').textContent");
    if (rendered.includes('ready: 4/4') || rendered.includes('stopped')) break;
    await sleep(250);
  }
  if (!rendered.includes('ready: 4/4')) throw new Error('Four real canonical CPU proofs were not generated: ' + rendered);
  let initial = await execute("document.getElementById('exhibition-study-launch').click();const ledger=document.getElementById('exhibition-recipe-ledger');ledger.open=true;return {open:document.getElementById('exhibition-study-dialog').open,shown:!ledger.hidden,rows:document.querySelectorAll('#exhibition-recipe-ledger-rows tr').length,relation:document.querySelector('#exhibition-recipe-ledger-rows tr td:last-child')?.textContent,images:[...document.querySelectorAll('.exhibition-study-frame:not([hidden]) img')].map(i=>({w:i.naturalWidth,h:i.naturalHeight,src:i.currentSrc}))}");
  for (let i = 0; i < 30 && !initial.shown; i += 1) {
    await sleep(100);
    initial = await execute("const ledger=document.getElementById('exhibition-recipe-ledger');return {open:document.getElementById('exhibition-study-dialog').open,shown:!ledger.hidden,rows:document.querySelectorAll('#exhibition-recipe-ledger-rows tr').length,relation:document.querySelector('#exhibition-recipe-ledger-rows tr td:last-child')?.textContent,images:[...document.querySelectorAll('.exhibition-study-frame:not([hidden]) img')].map(i=>({w:i.naturalWidth,h:i.naturalHeight,src:i.currentSrc}))}");
  }
  if (!initial.open || !initial.shown || initial.rows !== 10 || initial.relation !== 'Single work' ||
      initial.images.length !== 1 || initial.images[0].w !== 96 || initial.images[0].h !== 64 ||
      !initial.images[0].src.startsWith('blob:')) throw new Error('Unverified initial recipe score: ' + JSON.stringify(initial));
  let atlas = await execute("document.getElementById('exhibition-study-pin').click();document.getElementById('exhibition-study-next').click();const cells=[...document.querySelectorAll('#exhibition-recipe-ledger-rows tr')].map(x=>({name:x.querySelector('th').textContent,relation:x.lastElementChild.textContent}));return {status:document.getElementById('exhibition-study-status').textContent,frames:document.querySelectorAll('.exhibition-study-frame:not([hidden]) img').length,cells,notes:document.getElementById('exhibition-recipe-ledger-status').textContent}");
  for (let i = 0; i < 30 && !atlas.notes.includes('Two accepted'); i += 1) {
    await sleep(100);
    atlas = await execute("const cells=[...document.querySelectorAll('#exhibition-recipe-ledger-rows tr')].map(x=>({name:x.querySelector('th').textContent,relation:x.lastElementChild.textContent}));return {status:document.getElementById('exhibition-study-status').textContent,frames:document.querySelectorAll('.exhibition-study-frame:not([hidden]) img').length,cells,notes:document.getElementById('exhibition-recipe-ledger-status').textContent}");
  }
  if (!atlas.status.includes('Operator Atlas') || atlas.frames !== 2 ||
      atlas.cells.find((x) => x.name === 'Ordered field stack')?.relation !== 'Different' ||
      atlas.cells.find((x) => x.name === 'Material behaviours')?.relation !== 'Identical' ||
      !atlas.notes.includes('Two accepted')) throw new Error('A/B exact recipe differences invalid: ' + JSON.stringify(atlas));
  let pulse = await execute("document.getElementById('exhibition-study-next').click();return {status:document.getElementById('exhibition-study-status').textContent,timeline:[...document.querySelectorAll('#exhibition-recipe-ledger-commands section:last-child li')].map(x=>x.textContent),relation:[...document.querySelectorAll('#exhibition-recipe-ledger-rows tr')].find(x=>x.querySelector('th').textContent==='Interventions')?.lastElementChild.textContent}");
  for (let i = 0; i < 30 && pulse.timeline.length !== 6; i += 1) {
    await sleep(100);
    pulse = await execute("return {status:document.getElementById('exhibition-study-status').textContent,timeline:[...document.querySelectorAll('#exhibition-recipe-ledger-commands section:last-child li')].map(x=>x.textContent),relation:[...document.querySelectorAll('#exhibition-recipe-ledger-rows tr')].find(x=>x.querySelector('th').textContent==='Interventions')?.lastElementChild.textContent}");
  }
  if (!pulse.status.includes('Timeline Pulse') || pulse.timeline.length !== 6 ||
      !pulse.timeline[0].includes('tick 8') || !pulse.timeline[5].includes('tick 34') ||
      pulse.relation !== 'Different') throw new Error('Command register was not the real accepted timeline: ' + JSON.stringify(pulse));
  await request('POST', '/session/' + sessionId + '/window/rect', { width: 1280, height: 940 });
  await execute("document.getElementById('exhibition-recipe-ledger').scrollIntoView({block:'start'})");
  const screenshot = await request('GET', '/session/' + sessionId + '/screenshot');
  if (!screenshot?.value) throw new Error('No actual browser screenshot.');
  await writeFile('exhibition-recipe-score-' + browser + '.png', Buffer.from(screenshot.value, 'base64'));
  const exported = await execute("window.__ledgerExport=null;const original=URL.createObjectURL;URL.createObjectURL=function(blob){if(blob.type==='application/json')blob.text().then(t=>window.__ledgerExport=t);return original.call(this,blob)};document.getElementById('exhibition-recipe-ledger-download').click();URL.createObjectURL=original;return true");
  if (!exported) throw new Error('Export click failed.');
  let receipt;
  for (let i = 0; i < 40; i += 1) {
    const serialized = await execute("return window.__ledgerExport");
    if (serialized) { receipt = JSON.parse(serialized); break; }
    await sleep(100);
  }
  if (receipt?.version !== 'fw-exhibition-recipe-ledger-v1' ||
      receipt.a?.id !== 'first-weave' || receipt.b?.id !== 'timeline-pulse' ||
      receipt.b.score.commands.length !== 6 ||
      !/^[a-f0-9]{16}$/.test(receipt.a.rawRgbaHash) ||
      receipt.comparison.length !== 10) throw new Error('Downloaded recipe score has invalid provenance.');
  let after = await execute("document.getElementById('exhibition-study-close').click();return {open:document.getElementById('exhibition-study-dialog').open,hidden:document.getElementById('exhibition-recipe-ledger').hidden,canonical:document.documentElement.dataset.fieldweaverCanonicalRecipeHash}");
  for (let i = 0; i < 30 && !after.hidden; i += 1) {
    await sleep(100);
    after = await execute("return {open:document.getElementById('exhibition-study-dialog').open,hidden:document.getElementById('exhibition-recipe-ledger').hidden,canonical:document.documentElement.dataset.fieldweaverCanonicalRecipeHash}");
  }
  if (after.open || !after.hidden || before !== after.canonical) {
    throw new Error('Read-only score changed editor state or survived dialog close: ' + JSON.stringify(after));
  }
  await writeFile('exhibition-recipe-score-' + browser + '.json',
    JSON.stringify({ browser, before, initial, atlas, pulse, receipt, after }, null, 2) + '\n');
  console.log(JSON.stringify({ browser, canonicalProofs: 4, deltaRows: atlas.cells.length,
    interventionEvents: pulse.timeline.length, exportedPair: [receipt.a.id, receipt.b.id],
    editorUnchanged: true }, null, 2));
} finally {
  if (sessionId) { try { await request('DELETE', '/session/' + sessionId); } catch { /* cleanup */ } }
  driver.kill('SIGTERM');
}
