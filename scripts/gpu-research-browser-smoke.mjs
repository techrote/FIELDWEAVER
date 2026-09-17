import { spawn, spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const browser = process.argv[2];
if (!['chrome', 'firefox'].includes(browser)) throw new Error('Usage: node scripts/gpu-research-browser-smoke.mjs <chrome|firefox>');

const driverName = browser === 'chrome' ? 'chromedriver' : 'geckodriver';
const port = browser === 'chrome' ? 9519 : 4448;
const baseUrl = `http://127.0.0.1:${port}`;
const appUrl = process.env.FIELDWEAVER_SMOKE_URL ?? 'http://127.0.0.1:4173/';
const evidencePath = `gpu-research-smoke-${browser}.log`;

function commandPath(name) {
  const result = spawnSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

const driverPath = commandPath(driverName);
if (!driverPath) throw new Error(`${driverName} is not available on PATH; FW-015 browser evidence cannot be claimed.`);
const driver = spawn(driverPath, browser === 'chrome' ? [`--port=${port}`] : ['--port', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe']
});
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
  if (!response.ok) throw new Error(`${method} ${path} failed ${response.status}: ${text.slice(0, 1200)}`);
  return payload;
}

async function waitForDriver() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      if ((await request('GET', '/status'))?.value?.ready !== false) return;
    } catch { /* retry until the driver binds */ }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${driverName}.\n${driverLog}`);
}

function capabilities() {
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
              '--enable-unsafe-webgpu',
              '--ignore-gpu-blocklist'
            ]
          }
        }
      }
    };
  }
  return {
    capabilities: {
      alwaysMatch: {
        browserName: 'firefox',
        'moz:firefoxOptions': {
          args: process.env.DISPLAY ? [] : ['-headless'],
          prefs: {
            'dom.webgpu.enabled': true,
            'gfx.webrender.software': true
          }
        }
      }
    }
  };
}

let sessionId = null;
try {
  await waitForDriver();
  const created = await request('POST', '/session', capabilities());
  sessionId = created?.value?.sessionId ?? created?.sessionId;
  if (!sessionId) throw new Error(`WebDriver session missing: ${JSON.stringify(created)}`);
  const browserCapabilities = created?.value?.capabilities ?? created?.value ?? {};
  await request('POST', `/session/${sessionId}/timeouts`, { script: 120_000, pageLoad: 30_000 });
  await request('POST', `/session/${sessionId}/url`, { url: appUrl });

  const execution = await request('POST', `/session/${sessionId}/execute/async`, {
    script: `
      const done = arguments[arguments.length - 1];
      (async () => {
        try {
          const research = await import('/src/sim/gpu-research.js');
          const candidate = await research.createWebGpuTranslationCandidate(navigator);
          const base = {
            userAgent: navigator.userAgent,
            navigatorGpuPresent: Boolean(navigator.gpu),
            canonicalGpuEnabled: research.CANONICAL_GPU_ACCELERATION_ENABLED
          };
          if (!candidate.available) {
            done({ ...base, available: false, reason: candidate.reason });
            return;
          }
          try {
            const conformance = await research.runTranslationShadowConformance(candidate);
            if (!conformance.passed) {
              done({ ...base, available: true, environment: candidate.environment, conformance });
              return;
            }
            const benchmark = await research.benchmarkTranslationCandidate(candidate, {
              sizes: [1024, 8192, 30000],
              repeats: 5,
              warmups: 1
            });
            const gate = await research.evaluateCanonicalGpuAcceleration({ candidate });
            done({ ...base, available: true, environment: candidate.environment, conformance, benchmark, gate });
          } finally {
            candidate.destroy();
          }
        } catch (error) {
          done({ error: error && error.stack ? error.stack : String(error) });
        }
      })();
    `,
    args: []
  });
  const result = execution?.value;
  if (!result || result.error) throw new Error(`FW-015 browser harness failed: ${result?.error ?? JSON.stringify(result)}`);
  if (result.canonicalGpuEnabled !== false) throw new Error('FW-015 unexpectedly enabled a canonical GPU backend.');
  if (result.available && result.conformance?.passed !== true) {
    throw new Error(`Available WebGPU candidate failed equivalence: ${JSON.stringify(result.conformance)}`);
  }
  if (result.available && result.gate?.backend !== 'cpu') {
    throw new Error(`FW-015 gate selected a non-CPU canonical backend: ${JSON.stringify(result.gate)}`);
  }

  const evidence = {
    browser,
    browserVersion: browserCapabilities.browserVersion ?? browserCapabilities.version ?? 'unknown',
    platformName: browserCapabilities.platformName ?? 'unknown',
    result
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n\n--- WebDriver log ---\n${driverLog}`);
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  const failureText = `${error?.stack ?? error}\n\n--- WebDriver log ---\n${driverLog}`;
  await writeFile(evidencePath, failureText);
  console.error(failureText);
  throw error;
} finally {
  if (sessionId) {
    try { await request('DELETE', `/session/${sessionId}`); } catch { /* cleanup only */ }
  }
  driver.kill('SIGTERM');
}
