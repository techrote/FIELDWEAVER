import { spawn, spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const browser = process.argv[2];
if (!['chrome', 'firefox'].includes(browser)) throw new Error('Usage: node scripts/browser-smoke.mjs <chrome|firefox>');

const driverName = browser === 'chrome' ? 'chromedriver' : 'geckodriver';
const port = browser === 'chrome' ? 9515 : 4444;
const baseUrl = `http://127.0.0.1:${port}`;
const appUrl = process.env.FIELDWEAVER_SMOKE_URL ?? 'http://127.0.0.1:4173/';
const evidencePath = `browser-smoke-${browser}.log`;

function commandPath(name) {
  const result = spawnSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

const driverPath = commandPath(driverName);
if (!driverPath) throw new Error(`${driverName} is not available on PATH; browser smoke cannot be claimed.`);

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
  if (text) {
    try { payload = JSON.parse(text); } catch { throw new Error(`${method} ${path} returned non-JSON ${response.status}: ${text.slice(0, 500)}`); }
  }
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

function sessionCapabilities() {
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

function diagnosticLine(snapshot, prefix) { return snapshot.diagnostics.find((line) => line.startsWith(prefix)) ?? ''; }
function geometryRebuildCount(snapshot) {
  const match = diagnosticLine(snapshot, 'Geometry cache:').match(/rebuilds\s+(\d+)/);
  return match ? Number(match[1]) : NaN;
}

let sessionId = null;
try {
  await waitForDriver();
  const created = await request('POST', '/session', sessionCapabilities());
  sessionId = created?.value?.sessionId ?? created?.sessionId;
  if (!sessionId) throw new Error(`WebDriver did not return a session ID: ${JSON.stringify(created)}`);
  const capabilities = created?.value?.capabilities ?? created?.value ?? {};

  await request('POST', `/session/${sessionId}/window/rect`, { width: 1280, height: 820, x: 0, y: 0 });
  await request('POST', `/session/${sessionId}/url`, { url: appUrl });

  const execute = async (script, args = []) => (await request('POST', `/session/${sessionId}/execute/sync`, { script, args }))?.value;
  const snapshotScript = `
    const canvas = document.querySelector('#preview-canvas');
    const gl = canvas?.getContext('webgl2');
    const controls = [...document.querySelectorAll('button, input, select, textarea')];
    return {
      readyState: document.readyState,
      rendererState: document.documentElement.dataset.fieldweaverRendererState ?? '',
      editorState: document.documentElement.dataset.fieldweaverEditorState ?? '',
      canonicalResultHash: document.documentElement.dataset.fieldweaverCanonicalResultHash ?? '',
      canonicalRecipeHash: document.documentElement.dataset.fieldweaverCanonicalRecipeHash ?? '',
      editorTick: Number(document.documentElement.dataset.fieldweaverEditorTick ?? -1),
      editorFields: Number(document.documentElement.dataset.fieldweaverEditorFields ?? -1),
      editorEmitters: Number(document.documentElement.dataset.fieldweaverEditorEmitters ?? -1),
      lutAssets: Number(document.documentElement.dataset.fieldweaverLutAssets ?? -1),
      lutMappings: Number(document.documentElement.dataset.fieldweaverLutMappings ?? -1),
      lutPanelReady: document.querySelector('.lut-panel')?.dataset.ready ?? '',
      lutJson: document.querySelector('#lut-json')?.value ?? '',
      renderRequests: Number(document.documentElement.dataset.fieldweaverRenderRequests ?? 0),
      renderExecutions: Number(document.documentElement.dataset.fieldweaverRenderExecutions ?? 0),
      message: document.querySelector('.renderer-message')?.textContent ?? '',
      diagnostics: [...document.querySelectorAll('.diagnostic-list li')].map((node) => node.textContent ?? ''),
      materialLegend: [...document.querySelectorAll('.material-legend [data-material]')].map((node) => node.dataset.material),
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      webgl2: Boolean(gl), contextLost: gl ? gl.isContextLost() : true, glError: gl ? gl.getError() : -1,
      glVersion: gl ? String(gl.getParameter(gl.VERSION)) : '',
      glslVersion: gl ? String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION)) : '',
      renderer: gl ? String(gl.getParameter(gl.RENDERER)) : '', vendor: gl ? String(gl.getParameter(gl.VENDOR)) : '',
      controlCount: controls.length,
      unlabeledControls: controls.filter((node) => {
        if (node.tagName === 'BUTTON') return !(node.textContent ?? '').trim() && !node.getAttribute('aria-label');
        return !node.id || !(document.querySelector('label[for="' + node.id + '"]') || node.closest('label') || node.getAttribute('aria-label'));
      }).length
    };
  `;

  const deadline = Date.now() + 20_000;
  let initial = null;
  while (Date.now() < deadline) {
    initial = await execute(snapshotScript);
    if (initial?.rendererState === 'ready' && initial?.editorState === 'ready' && initial?.lutPanelReady === 'true') break;
    if (initial?.rendererState === 'unavailable') break;
    await sleep(200);
  }
  if (!initial || initial.rendererState !== 'ready' || initial.editorState !== 'ready' || initial.lutPanelReady !== 'true') throw new Error(`Editor/renderer/LUT panel did not become ready: ${JSON.stringify(initial)}`);
  if (!initial.webgl2 || initial.contextLost || initial.glError !== 0) throw new Error(`WebGL2 context is not healthy: ${JSON.stringify(initial)}`);
  if (!initial.canonicalRecipeHash || initial.canonicalResultHash !== initial.canonicalRecipeHash) throw new Error('Canonical editor identity was not published consistently.');
  if (initial.controlCount < 30 || initial.unlabeledControls !== 0) throw new Error(`Editor controls are incomplete or unlabeled: ${JSON.stringify(initial)}`);
  if (initial.editorFields < 2 || initial.editorEmitters < 1 || initial.editorTick !== 0) throw new Error(`Fresh editor model is not usable: ${JSON.stringify(initial)}`);
  if (initial.lutAssets < 2 || initial.lutMappings < 2) throw new Error(`Built-in LUT examples/mappings are missing: ${JSON.stringify(initial)}`);

  const expectedMaterials = ['dust', 'filament', 'ink', 'shard'];
  if (JSON.stringify([...initial.materialLegend].sort()) !== JSON.stringify(expectedMaterials)) throw new Error(`Four-material legend is incomplete: ${JSON.stringify(initial.materialLegend)}`);
  const drawCalls = Number(diagnosticLine(initial, 'Draw calls:').split(':')[1]?.trim());
  if (!diagnosticLine(initial, 'Renderer:').includes('WebGL2 preview') || !Number.isInteger(drawCalls) || drawCalls < 2) throw new Error(`Renderer diagnostics do not prove submitted artwork/overlays: ${JSON.stringify(initial.diagnostics)}`);

  // LUT workflow: edit one channel entry, export valid normalized JSON, generate another asset, and assign a canonical mapping.
  await execute(`
    const channel = document.querySelector('#lut-channel');
    channel.value = 'r'; channel.dispatchEvent(new Event('change', { bubbles: true }));
  `);
  await sleep(60);
  await execute(`
    const index = document.querySelector('#lut-entry-index'); index.value = '0'; index.dispatchEvent(new Event('change', { bubbles: true }));
    const value = document.querySelector('#lut-entry-value'); value.value = '12345';
    document.querySelector('#lut-entry-apply').click();
  `);
  await sleep(120);
  const afterLutEdit = await execute(snapshotScript);
  if (afterLutEdit.canonicalRecipeHash === initial.canonicalRecipeHash || afterLutEdit.editorTick !== 0) throw new Error('LUT entry editing did not change authoring identity/reset semantics.');

  await execute(`document.querySelector('#lut-export-json').click();`);
  await sleep(60);
  const afterExport = await execute(snapshotScript);
  let exportedLut;
  try { exportedLut = JSON.parse(afterExport.lutJson); } catch { throw new Error('LUT JSON export is not valid JSON.'); }
  if (exportedLut.schemaVersion !== 'fw-lut-v1' || exportedLut.size !== 256 || exportedLut.channels.r[0] !== 12345) throw new Error(`LUT JSON export does not reflect edited model: ${afterExport.lutJson.slice(0, 300)}`);

  await execute(`document.querySelector('#lut-generate-512').click();`);
  await sleep(120);
  const afterGenerate = await execute(snapshotScript);
  if (afterGenerate.lutAssets !== initial.lutAssets + 1 || afterGenerate.canonicalRecipeHash === afterLutEdit.canonicalRecipeHash) throw new Error('512-entry LUT generation did not update model identity.');

  await execute(`
    const destination = document.querySelector('#lut-destination'); destination.value = 'depositionStrengthQ16'; destination.dispatchEvent(new Event('change', { bubbles: true }));
    const source = document.querySelector('#lut-source'); source.value = 'ageTicks';
    const channel = document.querySelector('#lut-mapping-channel'); channel.value = 'logic';
    document.querySelector('#lut-mapping-assign').click();
  `);
  await sleep(120);
  const afterMapping = await execute(snapshotScript);
  if (afterMapping.lutMappings < initial.lutMappings + 1 || afterMapping.canonicalRecipeHash === afterGenerate.canonicalRecipeHash) throw new Error('LUT mapping assignment did not update authoring identity.');

  // Real editor workflow: add a field, paint it, undo/redo, place and retarget an emitter, step/run/reset.
  await execute(`document.querySelector('#field-add').click();`);
  await sleep(100);
  const afterAddField = await execute(snapshotScript);
  if (afterAddField.editorFields !== initial.editorFields + 1 || afterAddField.canonicalRecipeHash === afterMapping.canonicalRecipeHash) throw new Error('Adding a field did not update editor model identity.');

  await execute(`
    document.querySelector('#tool-paint').click();
    const canvas = document.querySelector('#preview-canvas');
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 41, clientX: 420, clientY: 330 }));
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 41, clientX: 455, clientY: 345 }));
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 41, clientX: 490, clientY: 365 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 41, clientX: 490, clientY: 365 }));
  `);
  await sleep(150);
  const afterPaint = await execute(snapshotScript);
  if (afterPaint.canonicalRecipeHash === afterAddField.canonicalRecipeHash || afterPaint.editorTick !== 0) throw new Error('Painting did not create a canonical authoring edit/reset.');

  await execute(`document.querySelector('#authoring-undo').click();`);
  await sleep(80);
  const afterUndo = await execute(snapshotScript);
  if (afterUndo.canonicalRecipeHash !== afterAddField.canonicalRecipeHash) throw new Error('Authoring undo did not restore the pre-paint identity.');
  await execute(`document.querySelector('#authoring-redo').click();`);
  await sleep(80);
  const afterRedo = await execute(snapshotScript);
  if (afterRedo.canonicalRecipeHash !== afterPaint.canonicalRecipeHash) throw new Error('Authoring redo did not restore the painted identity.');

  await execute(`
    document.querySelector('#tool-place-emitter').click();
    const canvas = document.querySelector('#preview-canvas');
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 42, clientX: 540, clientY: 360 }));
  `);
  await sleep(100);
  const afterEmitter = await execute(snapshotScript);
  if (afterEmitter.editorEmitters !== initial.editorEmitters + 1 || afterEmitter.canonicalRecipeHash === afterRedo.canonicalRecipeHash) throw new Error('Canvas emitter placement did not update editor model identity.');

  await execute(`
    const material = document.querySelector('#emitter-material');
    if (material.options.length > 1) material.value = material.options[1].value;
    material.dispatchEvent(new Event('change', { bubbles: true }));
    const rate = document.querySelector('#emitter-rate');
    rate.value = '3'; rate.dispatchEvent(new Event('change', { bubbles: true }));
  `);
  await sleep(100);
  const authored = await execute(snapshotScript);
  const authoredHash = authored.canonicalRecipeHash;
  if (!authoredHash || authoredHash === afterEmitter.canonicalRecipeHash) throw new Error('Emitter material/rate editing did not update authoring identity.');

  await execute(`document.querySelector('#step-once').click();`);
  await sleep(80);
  if ((await execute(snapshotScript)).editorTick !== 1) throw new Error('Exact single-step did not advance one tick.');
  await execute(`
    const input = document.querySelector('#multi-step-count'); input.value = '3'; input.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#step-many').click();
  `);
  await sleep(80);
  if ((await execute(snapshotScript)).editorTick !== 4) throw new Error('Configured multi-step did not advance exact tick count.');
  await execute(`document.querySelector('#run-toggle').click();`);
  await sleep(180);
  await execute(`document.querySelector('#run-toggle').click();`);
  await sleep(80);
  const afterRun = await execute(snapshotScript);
  if (afterRun.editorTick <= 4) throw new Error('Run/pause transport did not advance simulation ticks.');
  if (afterRun.canonicalRecipeHash !== authoredHash) throw new Error('Running the simulation changed authoring identity.');
  await execute(`document.querySelector('#simulation-reset').click();`);
  await sleep(100);
  const afterReset = await execute(snapshotScript);
  if (afterReset.editorTick !== 0 || afterReset.canonicalRecipeHash !== authoredHash) throw new Error('Deterministic reset changed authoring identity or failed to return to tick zero.');

  // Preserve FW-016 regression coverage after editor work: burst view-only interaction must reuse geometry and coalesce rendering.
  await execute(`document.querySelector('#tool-pan').click();`);
  await sleep(80);
  const beforeInteraction = await execute(snapshotScript);
  const beforeViewportLine = diagnosticLine(beforeInteraction, 'Preview viewport:');
  const beforeRebuilds = geometryRebuildCount(beforeInteraction);
  if (!Number.isInteger(beforeRebuilds) || beforeRebuilds < 1) throw new Error(`Geometry cache diagnostics missing: ${JSON.stringify(beforeInteraction.diagnostics)}`);
  const burstPointerMoves = 48;
  const burstWheelEvents = 12;
  await execute(`
    const canvas = document.querySelector('#preview-canvas');
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, clientX: 300, clientY: 250 }));
    for (let index = 1; index <= ${burstPointerMoves}; index += 1) canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: 300 + index, clientY: 250 + Math.floor(index / 2) }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, clientX: 348, clientY: 274 }));
    for (let index = 0; index < ${burstWheelEvents}; index += 1) canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: index % 2 === 0 ? -20 : -10 }));
  `);
  await sleep(200);
  const afterInteraction = await execute(snapshotScript);
  if (afterInteraction.rendererState !== 'ready' || afterInteraction.glError !== 0) throw new Error(`Pan/zoom caused preview failure: ${JSON.stringify(afterInteraction)}`);
  const afterViewportLine = diagnosticLine(afterInteraction, 'Preview viewport:');
  if (!beforeViewportLine || !afterViewportLine || beforeViewportLine === afterViewportLine) throw new Error(`Pan/zoom did not update viewport diagnostics: ${beforeViewportLine} -> ${afterViewportLine}`);
  if (geometryRebuildCount(afterInteraction) !== beforeRebuilds || !diagnosticLine(afterInteraction, 'Geometry cache:').includes('reused')) throw new Error('View-only interaction rebuilt stable artwork geometry.');
  if (afterInteraction.canonicalRecipeHash !== authoredHash) throw new Error('View-only interaction changed authoring identity.');
  const requestDelta = afterInteraction.renderRequests - beforeInteraction.renderRequests;
  const executionDelta = afterInteraction.renderExecutions - beforeInteraction.renderExecutions;
  if (requestDelta < burstPointerMoves + burstWheelEvents || executionDelta > 2) throw new Error(`RAF coalescing regression: ${requestDelta} requests / ${executionDelta} executions.`);

  const beforeFramebuffer = diagnosticLine(afterInteraction, 'Framebuffer:');
  await request('POST', `/session/${sessionId}/window/rect`, { width: 1080, height: 720, x: 0, y: 0 });
  await sleep(250);
  const afterResize = await execute(snapshotScript);
  const afterFramebuffer = diagnosticLine(afterResize, 'Framebuffer:');
  if (afterResize.rendererState !== 'ready' || !afterFramebuffer || beforeFramebuffer === afterFramebuffer) throw new Error(`Resize did not rebuild framebuffer cleanly: ${beforeFramebuffer} -> ${afterFramebuffer}`);
  if (geometryRebuildCount(afterResize) !== beforeRebuilds || afterResize.canonicalRecipeHash !== authoredHash) throw new Error('Resize changed stable geometry or authoring identity.');

  const screenshot = await request('GET', `/session/${sessionId}/screenshot`);
  const screenshotBytes = Buffer.from(screenshot?.value ?? '', 'base64');
  if (screenshotBytes.length < 10_000 || screenshotBytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Browser screenshot is missing or invalid (${screenshotBytes.length} bytes).`);
  const screenshotPath = `browser-smoke-${browser}.png`;
  await writeFile(screenshotPath, screenshotBytes);

  await sleep(100);
  if (/JavaScript error: http:\/\/127\.0\.0\.1:4173\/src\//.test(driverLog)) throw new Error(`Application JavaScript error observed in ${browser} WebDriver log.`);

  const evidence = {
    browser,
    browserVersion: capabilities.browserVersion ?? capabilities.version ?? 'unknown',
    platformName: capabilities.platformName ?? 'unknown',
    display: process.env.DISPLAY ?? null,
    webglVersion: afterResize.glVersion,
    glslVersion: afterResize.glslVersion,
    renderer: afterResize.renderer,
    vendor: afterResize.vendor,
    drawCalls,
    editorFields: afterResize.editorFields,
    editorEmitters: afterResize.editorEmitters,
    lutAssets: afterResize.lutAssets,
    lutMappings: afterResize.lutMappings,
    workflowFinalTick: afterResize.editorTick,
    geometryRebuilds: geometryRebuildCount(afterResize),
    interactionRenderRequests: requestDelta,
    interactionRenderExecutions: executionDelta,
    framebuffer: afterFramebuffer,
    screenshotBytes: screenshotBytes.length,
    screenshotPath
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
