import { spawn, spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const browser = process.argv[2];
if (!['chrome', 'firefox'].includes(browser)) throw new Error('Usage: node scripts/timeline-browser-smoke.mjs <chrome|firefox>');

const driverName = browser === 'chrome' ? 'chromedriver' : 'geckodriver';
const port = browser === 'chrome' ? 9515 : 4444;
const baseUrl = `http://127.0.0.1:${port}`;
const appUrl = process.env.FIELDWEAVER_SMOKE_URL ?? 'http://127.0.0.1:4173/';
const evidencePath = `timeline-smoke-${browser}.log`;

function commandPath(name) {
  const result = spawnSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

const driverPath = commandPath(driverName);
if (!driverPath) throw new Error(`${driverName} is not available on PATH; timeline browser smoke cannot be claimed.`);
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
  await request('POST', `/session/${sessionId}/window/rect`, { width: 1280, height: 900, x: 0, y: 0 });
  await request('POST', `/session/${sessionId}/url`, { url: appUrl });
  const execute = async (script, args = []) => (await request('POST', `/session/${sessionId}/execute/sync`, { script, args }))?.value;

  const snapshotScript = `
    const diagnostics = [...document.querySelectorAll('.diagnostic-list li')].map((node) => node.textContent ?? '');
    const geometry = diagnostics.find((line) => line.startsWith('Geometry cache:')) ?? '';
    const rebuildMatch = geometry.match(/rebuilds\\s+(\\d+)/);
    const timelineControls = [...document.querySelectorAll('.timeline-panel button, .timeline-panel input, .timeline-panel select, .timeline-panel textarea')];
    return {
      rendererState: document.documentElement.dataset.fieldweaverRendererState ?? '',
      editorState: document.documentElement.dataset.fieldweaverEditorState ?? '',
      recipeHash: document.documentElement.dataset.fieldweaverCanonicalRecipeHash ?? '',
      editorTick: Number(document.documentElement.dataset.fieldweaverEditorTick ?? -1),
      timelineTick: Number(document.documentElement.dataset.fieldweaverTimelineTick ?? -1),
      checkpointCount: Number(document.documentElement.dataset.fieldweaverTimelineCheckpoints ?? -1),
      timelineReady: document.querySelector('.timeline-panel')?.dataset.ready ?? '',
      playhead: Number(document.querySelector('#timeline-playhead')?.value ?? -1),
      eventLabels: [...document.querySelectorAll('#timeline-events [data-command-id]')].map((node) => ({ id: Number(node.dataset.commandId), text: node.textContent ?? '' })),
      timelineDiagnostics: [...document.querySelectorAll('#timeline-diagnostics li')].map((node) => node.textContent ?? ''),
      timelineControlCount: timelineControls.length,
      unlabeledTimelineControls: timelineControls.filter((node) => {
        if (node.tagName === 'BUTTON') return !(node.textContent ?? '').trim() && !node.getAttribute('aria-label');
        return !(node.closest('label') || node.getAttribute('aria-label'));
      }).length,
      geometryRebuilds: rebuildMatch ? Number(rebuildMatch[1]) : -1,
      previewDepositions: Number((diagnostics.find((line) => line.startsWith('Preview deposition window:')) ?? '').match(/window:\\s+(\\d+)/)?.[1] ?? -1)
    };
  `;

  const deadline = Date.now() + 20_000;
  let initial = null;
  while (Date.now() < deadline) {
    initial = await execute(snapshotScript);
    if (initial?.rendererState === 'ready' && initial?.editorState === 'ready' && initial?.timelineReady === 'true' && initial?.timelineTick === 0) break;
    await sleep(200);
  }
  if (!initial || initial.rendererState !== 'ready' || initial.editorState !== 'ready' || initial.timelineReady !== 'true') {
    throw new Error(`Timeline editor did not become ready: ${JSON.stringify(initial)}`);
  }
  if (!initial.recipeHash || initial.editorTick !== 0 || initial.timelineTick !== 0 || initial.playhead !== 0) {
    throw new Error(`Fresh timeline state is inconsistent: ${JSON.stringify(initial)}`);
  }
  if (initial.timelineControlCount < 14 || initial.unlabeledTimelineControls !== 0) {
    throw new Error(`Timeline controls are incomplete or unlabeled: ${JSON.stringify(initial)}`);
  }

  await execute(`
    const type = document.querySelector('#timeline-add-type');
    const tick = document.querySelector('#timeline-add-tick');
    type.value = 'set-emitter-rate'; tick.value = '4'; document.querySelector('#timeline-add').click();
  `);
  await sleep(180);
  await execute(`
    const type = document.querySelector('#timeline-add-type');
    const tick = document.querySelector('#timeline-add-tick');
    type.value = 'release-burst'; tick.value = '4'; document.querySelector('#timeline-add').click();
  `);
  await sleep(180);
  const added = await execute(snapshotScript);
  if (added.eventLabels.length < 2 || !added.eventLabels[0].text.includes('set-emitter-rate') || !added.eventLabels[1].text.includes('release-burst')) {
    throw new Error(`Same-tick events are not visibly ordered by command ID: ${JSON.stringify(added.eventLabels)}`);
  }
  const authoredHash = added.recipeHash;
  if (authoredHash === initial.recipeHash) throw new Error('Timeline authoring did not change recipe identity.');

  const burstId = added.eventLabels.find((entry) => entry.text.includes('release-burst'))?.id;
  if (!burstId) throw new Error('Could not identify release-burst event.');
  await execute(`
    document.querySelector('#timeline-event-${burstId}').click();
    document.querySelector('#timeline-earlier').click();
  `);
  await sleep(180);
  const reordered = await execute(snapshotScript);
  if (!reordered.eventLabels[0]?.text.includes('release-burst') || !reordered.eventLabels[1]?.text.includes('set-emitter-rate')) {
    throw new Error(`Same-tick Earlier did not change canonical visible order: ${JSON.stringify(reordered.eventLabels)}`);
  }
  await execute(`document.querySelector('#timeline-undo').click();`);
  await sleep(180);
  const undone = await execute(snapshotScript);
  if (!undone.eventLabels[0]?.text.includes('set-emitter-rate') || !undone.eventLabels[1]?.text.includes('release-burst')) {
    throw new Error(`Timeline undo did not restore event order: ${JSON.stringify(undone.eventLabels)}`);
  }

  await execute(`
    const count = document.querySelector('#multi-step-count');
    count.value = '40'; count.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#step-many').click();
  `);
  await sleep(350);
  const atForty = await execute(snapshotScript);
  if (atForty.editorTick !== 40 || atForty.timelineTick !== 40 || atForty.playhead !== 40) throw new Error(`Transport/playhead did not reach tick 40: ${JSON.stringify(atForty)}`);
  if (atForty.checkpointCount < 2) throw new Error(`Expected tick-32 checkpoint before seek: ${JSON.stringify(atForty)}`);
  const beforeSeekRebuilds = atForty.geometryRebuilds;
  const beforeSeekDepositions = atForty.previewDepositions;
  const hashBeforeSeek = atForty.recipeHash;

  await execute(`
    const target = document.querySelector('#timeline-target-tick');
    target.value = '35';
    document.querySelector('#timeline-seek').click();
  `);
  const seekDeadline = Date.now() + 10_000;
  let afterSeek = null;
  while (Date.now() < seekDeadline) {
    afterSeek = await execute(snapshotScript);
    const modelReady = afterSeek?.timelineTick === 35 && afterSeek?.editorTick === 35 && afterSeek?.playhead === 35;
    const rendererRebuilt = afterSeek?.geometryRebuilds > beforeSeekRebuilds;
    const previewShortened = beforeSeekDepositions < 0 || (afterSeek?.previewDepositions >= 0 && afterSeek.previewDepositions < beforeSeekDepositions);
    if (modelReady && rendererRebuilt && previewShortened) break;
    await sleep(100);
  }
  if (!afterSeek || afterSeek.timelineTick !== 35 || afterSeek.editorTick !== 35 || afterSeek.playhead !== 35) throw new Error(`Backward timeline seek did not reach tick 35: ${JSON.stringify(afterSeek)}`);
  if (afterSeek.recipeHash !== hashBeforeSeek) throw new Error('Seeking changed recipe identity.');
  if (!afterSeek.timelineDiagnostics.some((line) => /Last seek: 40 .* 35 via 32/.test(line))) {
    throw new Error(`Backward seek did not report checkpoint-assisted replay via tick 32: ${JSON.stringify(afterSeek.timelineDiagnostics)}`);
  }
  if (afterSeek.geometryRebuilds <= beforeSeekRebuilds) throw new Error(`Backward seek did not rebuild preview geometry after renderer catch-up: ${beforeSeekRebuilds} -> ${afterSeek.geometryRebuilds}`);
  if (beforeSeekDepositions >= 0 && afterSeek.previewDepositions >= beforeSeekDepositions) throw new Error(`Backward seek did not shorten canonical preview accumulation after renderer catch-up: ${beforeSeekDepositions} -> ${afterSeek.previewDepositions}`);

  await execute(`document.querySelector('#step-once').click();`);
  await sleep(180);
  const afterStep = await execute(snapshotScript);
  if (afterStep.editorTick !== 36 || afterStep.timelineTick !== 36 || afterStep.recipeHash !== hashBeforeSeek) {
    throw new Error(`Existing exact-step transport did not continue from timeline playhead: ${JSON.stringify(afterStep)}`);
  }

  const evidence = {
    browser,
    browserVersion: browserCapabilities.browserVersion ?? browserCapabilities.version ?? 'unknown',
    initialTimelineControls: initial.timelineControlCount,
    authoredEvents: added.eventLabels,
    reorderedEvents: reordered.eventLabels,
    tickBeforeSeek: atForty.timelineTick,
    tickAfterSeek: afterSeek.timelineTick,
    checkpointCountBeforeSeek: atForty.checkpointCount,
    lastSeek: afterSeek.timelineDiagnostics.find((line) => line.startsWith('Last seek:')) ?? '',
    geometryRebuildsBeforeSeek: beforeSeekRebuilds,
    geometryRebuildsAfterSeek: afterSeek.geometryRebuilds,
    previewDepositionsBeforeSeek: beforeSeekDepositions,
    previewDepositionsAfterSeek: afterSeek.previewDepositions,
    finalTick: afterStep.timelineTick,
    recipeHash: afterStep.recipeHash
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
