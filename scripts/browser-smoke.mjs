import { spawn, spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const browser = process.argv[2];
if (!['chrome', 'firefox'].includes(browser)) {
  throw new Error('Usage: node scripts/browser-smoke.mjs <chrome|firefox>');
}

const driverName = browser === 'chrome' ? 'chromedriver' : 'geckodriver';
const port = browser === 'chrome' ? 9515 : 4444;
const baseUrl = `http://127.0.0.1:${port}`;
const appUrl = process.env.FIELDWEAVER_SMOKE_URL ?? 'http://127.0.0.1:4173/';
const evidencePath = `browser-smoke-${browser}.log`;

function commandPath(name) {
  const result = spawnSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

const driverPath = commandPath(driverName);
if (!driverPath) {
  throw new Error(`${driverName} is not available on PATH; browser smoke cannot be claimed.`);
}

const driverArgs = browser === 'chrome' ? [`--port=${port}`] : ['--port', String(port)];
const driver = spawn(driverPath, driverArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
let driverLog = '';
driver.stdout.on('data', (chunk) => { driverLog += chunk.toString(); });
driver.stderr.on('data', (chunk) => { driverLog += chunk.toString(); });

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(method, path, body = undefined) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`${method} ${path} returned non-JSON ${response.status}: ${text.slice(0, 500)}`);
    }
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} failed ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function waitForDriver() {
  const deadline = Date.now() + 15_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const payload = await request('GET', '/status');
      if (payload?.value?.ready !== false) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${driverName}: ${lastError?.message ?? 'no status response'}\n${driverLog}`);
}

function sessionCapabilities() {
  if (browser === 'chrome') {
    return {
      capabilities: {
        alwaysMatch: {
          browserName: 'chrome',
          'goog:chromeOptions': {
            args: [
              '--headless=new',
              '--no-sandbox',
              '--disable-dev-shm-usage',
              '--enable-webgl',
              '--ignore-gpu-blocklist',
              '--use-angle=swiftshader'
            ]
          }
        }
      }
    };
  }
  const args = process.env.DISPLAY ? [] : ['-headless'];
  return {
    capabilities: {
      alwaysMatch: {
        browserName: 'firefox',
        'moz:firefoxOptions': {
          args,
          prefs: {
            'webgl.disabled': false,
            'webgl.force-enabled': true,
            'gfx.webrender.all': true,
            'gfx.webrender.software': true
          }
        }
      }
    }
  };
}

function diagnosticLine(snapshot, prefix) {
  return snapshot.diagnostics.find((line) => line.startsWith(prefix)) ?? '';
}

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

  const execute = async (script, args = []) => {
    const result = await request('POST', `/session/${sessionId}/execute/sync`, { script, args });
    return result?.value;
  };

  const snapshotScript = `
    const canvas = document.querySelector('#preview-canvas');
    const gl = canvas?.getContext('webgl2');
    const diagnostics = [...document.querySelectorAll('.diagnostic-list li')].map((node) => node.textContent ?? '');
    return {
      readyState: document.readyState,
      rendererState: document.documentElement.dataset.fieldweaverRendererState ?? '',
      canonicalResultHash: document.documentElement.dataset.fieldweaverCanonicalResultHash ?? '',
      renderRequests: Number(document.documentElement.dataset.fieldweaverRenderRequests ?? 0),
      renderExecutions: Number(document.documentElement.dataset.fieldweaverRenderExecutions ?? 0),
      message: document.querySelector('.renderer-message')?.textContent ?? '',
      diagnostics,
      materialLegend: [...document.querySelectorAll('.material-legend [data-material]')].map((node) => node.dataset.material),
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      webgl2: Boolean(gl),
      contextLost: gl ? gl.isContextLost() : true,
      glError: gl ? gl.getError() : -1,
      glVersion: gl ? String(gl.getParameter(gl.VERSION)) : '',
      glslVersion: gl ? String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION)) : '',
      renderer: gl ? String(gl.getParameter(gl.RENDERER)) : '',
      vendor: gl ? String(gl.getParameter(gl.VENDOR)) : ''
    };
  `;

  const deadline = Date.now() + 20_000;
  let initial = null;
  while (Date.now() < deadline) {
    initial = await execute(snapshotScript);
    if (initial?.rendererState === 'ready' || initial?.rendererState === 'unavailable') break;
    await sleep(200);
  }

  if (!initial) throw new Error('Browser returned no smoke snapshot.');
  if (initial.rendererState !== 'ready') {
    throw new Error(`WebGL2 renderer did not become ready: ${JSON.stringify(initial)}`);
  }
  if (!initial.webgl2 || initial.contextLost || initial.glError !== 0) {
    throw new Error(`WebGL2 context is not healthy: ${JSON.stringify(initial)}`);
  }
  if (!initial.canonicalResultHash) throw new Error('Canonical demo result hash was not published for browser isolation evidence.');
  const initialRebuilds = geometryRebuildCount(initial);
  if (!Number.isInteger(initialRebuilds) || initialRebuilds < 1) {
    throw new Error(`Initial geometry-cache diagnostics are missing: ${JSON.stringify(initial.diagnostics)}`);
  }

  const expectedMaterials = ['dust', 'filament', 'ink', 'shard'];
  const actualMaterials = [...initial.materialLegend].sort();
  if (JSON.stringify(actualMaterials) !== JSON.stringify(expectedMaterials)) {
    throw new Error(`Four-material legend is incomplete: ${JSON.stringify(actualMaterials)}`);
  }
  const rendererLine = diagnosticLine(initial, 'Renderer:');
  const drawLine = diagnosticLine(initial, 'Draw calls:');
  const drawCalls = Number(drawLine.split(':')[1]?.trim());
  if (!rendererLine.includes('WebGL2 preview') || !Number.isInteger(drawCalls) || drawCalls < 2) {
    throw new Error(`Renderer diagnostics do not prove submitted artwork: ${JSON.stringify(initial.diagnostics)}`);
  }

  const beforeViewportLine = diagnosticLine(initial, 'Preview viewport:');
  const burstPointerMoves = 48;
  const burstWheelEvents = 12;
  await execute(`
    const canvas = document.querySelector('#preview-canvas');
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, clientX: 300, clientY: 250 }));
    for (let index = 1; index <= ${burstPointerMoves}; index += 1) {
      canvas.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 7,
        clientX: 300 + index,
        clientY: 250 + Math.floor(index / 2)
      }));
    }
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, clientX: 348, clientY: 274 }));
    for (let index = 0; index < ${burstWheelEvents}; index += 1) {
      canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: index % 2 === 0 ? -20 : -10 }));
    }
  `);
  await sleep(200);
  const afterInteraction = await execute(snapshotScript);
  if (afterInteraction.rendererState !== 'ready' || afterInteraction.glError !== 0) {
    throw new Error(`Pan/zoom caused preview failure: ${JSON.stringify(afterInteraction)}`);
  }
  const afterViewportLine = diagnosticLine(afterInteraction, 'Preview viewport:');
  if (!beforeViewportLine || !afterViewportLine || beforeViewportLine === afterViewportLine) {
    throw new Error(`Pan/zoom did not update viewport diagnostics: ${beforeViewportLine} -> ${afterViewportLine}`);
  }
  if (geometryRebuildCount(afterInteraction) !== initialRebuilds) {
    throw new Error(`View-only interaction rebuilt artwork geometry: ${initialRebuilds} -> ${geometryRebuildCount(afterInteraction)}`);
  }
  if (!diagnosticLine(afterInteraction, 'Geometry cache:').includes('reused')) {
    throw new Error(`View-only interaction did not report geometry-cache reuse: ${JSON.stringify(afterInteraction.diagnostics)}`);
  }
  if (afterInteraction.canonicalResultHash !== initial.canonicalResultHash) {
    throw new Error('View-only interaction changed the published canonical result identity.');
  }
  const requestDelta = afterInteraction.renderRequests - initial.renderRequests;
  const executionDelta = afterInteraction.renderExecutions - initial.renderExecutions;
  if (requestDelta < burstPointerMoves + burstWheelEvents) {
    throw new Error(`Interaction render requests were not observed as expected: ${requestDelta}.`);
  }
  if (executionDelta > 2) {
    throw new Error(`RAF coalescing regression: ${requestDelta} requests produced ${executionDelta} render executions.`);
  }

  const beforeFramebuffer = diagnosticLine(afterInteraction, 'Framebuffer:');
  await request('POST', `/session/${sessionId}/window/rect`, { width: 1080, height: 720, x: 0, y: 0 });
  await sleep(250);
  const afterResize = await execute(snapshotScript);
  const afterFramebuffer = diagnosticLine(afterResize, 'Framebuffer:');
  if (afterResize.rendererState !== 'ready' || !afterFramebuffer || beforeFramebuffer === afterFramebuffer) {
    throw new Error(`Resize did not rebuild the framebuffer cleanly: ${beforeFramebuffer} -> ${afterFramebuffer}`);
  }
  if (geometryRebuildCount(afterResize) !== initialRebuilds) {
    throw new Error(`Resize incorrectly rebuilt stable artwork geometry: ${initialRebuilds} -> ${geometryRebuildCount(afterResize)}`);
  }
  if (afterResize.canonicalResultHash !== initial.canonicalResultHash) {
    throw new Error('Resize changed the published canonical result identity.');
  }

  const screenshot = await request('GET', `/session/${sessionId}/screenshot`);
  const screenshotBytes = Buffer.from(screenshot?.value ?? '', 'base64');
  if (screenshotBytes.length < 10_000 || screenshotBytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`Browser screenshot is missing or invalid (${screenshotBytes.length} bytes).`);
  }
  const screenshotPath = `browser-smoke-${browser}.png`;
  await writeFile(screenshotPath, screenshotBytes);

  await sleep(100);
  const appErrorPattern = /JavaScript error: http:\/\/127\.0\.0\.1:4173\/src\//;
  if (appErrorPattern.test(driverLog)) {
    throw new Error(`Application JavaScript error observed in ${browser} WebDriver log.`);
  }

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
    geometryRebuilds: geometryRebuildCount(afterResize),
    interactionRenderRequests: requestDelta,
    interactionRenderExecutions: executionDelta,
    framebuffer: afterFramebuffer,
    screenshotBytes: screenshotBytes.length,
    screenshotPath
  };
  const evidenceText = `${JSON.stringify(evidence, null, 2)}\n\n--- WebDriver log ---\n${driverLog}`;
  await writeFile(evidencePath, evidenceText);
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  const failureText = `${error?.stack ?? error}\n\n--- WebDriver log ---\n${driverLog}`;
  await writeFile(evidencePath, failureText);
  console.error(failureText);
  throw error;
} finally {
  if (sessionId) {
    try {
      await request('DELETE', `/session/${sessionId}`);
    } catch {
      // Driver teardown failure must not hide the primary smoke result.
    }
  }
  driver.kill('SIGTERM');
}
