import { spawn, spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const browser = process.argv[2];
if (!['chrome', 'firefox'].includes(browser)) throw new Error('Usage: node scripts/mutation-browser-smoke.mjs <chrome|firefox>');

const driverName = browser === 'chrome' ? 'chromedriver' : 'geckodriver';
const port = browser === 'chrome' ? 9515 : 4444;
const baseUrl = `http://127.0.0.1:${port}`;
const appUrl = process.env.FIELDWEAVER_SMOKE_URL ?? 'http://127.0.0.1:4173/';
const evidencePath = `mutation-smoke-${browser}.log`;

function commandPath(name) {
  const result = spawnSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

const driverPath = commandPath(driverName);
if (!driverPath) throw new Error(`${driverName} is not available on PATH; mutation browser smoke cannot be claimed.`);
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
  await request('POST', `/session/${sessionId}/window/rect`, { width: 1440, height: 1000, x: 0, y: 0 });
  await request('POST', `/session/${sessionId}/url`, { url: appUrl });
  const execute = async (script, args = []) => (await request('POST', `/session/${sessionId}/execute/sync`, { script, args }))?.value;

  const snapshotScript = `
    const panel = document.querySelector('.mutation-panel');
    const controls = [...document.querySelectorAll('.mutation-panel button, .mutation-panel input, .mutation-panel select')];
    const selected = document.querySelector('#mutation-variant-select');
    return {
      rendererState: document.documentElement.dataset.fieldweaverRendererState ?? '',
      editorState: document.documentElement.dataset.fieldweaverEditorState ?? '',
      mutationReady: document.documentElement.dataset.fieldweaverMutationPanel ?? '',
      recipeHash: document.documentElement.dataset.fieldweaverCanonicalRecipeHash ?? '',
      authoringHash: document.documentElement.dataset.fieldweaverAuthoringHash ?? '',
      variantCount: Number(document.documentElement.dataset.fieldweaverVariantCount ?? 0),
      comparisonCount: Number(document.documentElement.dataset.fieldweaverVariantComparisonCount ?? 0),
      comparisonTick: Number(document.documentElement.dataset.fieldweaverVariantComparisonTick ?? -1),
      optionCount: selected?.options?.length ?? 0,
      selectedVariant: selected?.value ?? '',
      selectedLabel: selected?.selectedOptions?.[0]?.textContent ?? '',
      lineage: document.querySelector('#mutation-lineage')?.textContent ?? '',
      diff: document.querySelector('#mutation-diff')?.textContent ?? '',
      status: document.querySelector('#mutation-status')?.textContent ?? '',
      comparisonCards: document.querySelectorAll('.variant-preview-card').length,
      comparisonCanvases: document.querySelectorAll('.variant-preview-canvas').length,
      comparisonHashes: [...document.querySelectorAll('.variant-preview-card code')].map((node) => node.textContent ?? ''),
      mutationControlCount: controls.length,
      unlabeledMutationControls: controls.filter((node) => {
        if (node.tagName === 'BUTTON') return !(node.textContent ?? '').trim() && !node.getAttribute('aria-label');
        return !(node.closest('label') || node.getAttribute('aria-label'));
      }).length,
      panelPresent: Boolean(panel)
    };
  `;

  const readyDeadline = Date.now() + 20_000;
  let initial = null;
  while (Date.now() < readyDeadline) {
    initial = await execute(snapshotScript);
    if (initial?.rendererState === 'ready' && initial?.editorState === 'ready' && initial?.mutationReady === 'ready' && initial?.panelPresent) break;
    await sleep(200);
  }
  if (!initial || initial.rendererState !== 'ready' || initial.editorState !== 'ready' || initial.mutationReady !== 'ready' || !initial.panelPresent) {
    throw new Error(`Mutation UI did not become ready: ${JSON.stringify(initial)}`);
  }
  if (!initial.recipeHash || initial.variantCount !== 0 || initial.optionCount !== 0) {
    throw new Error(`Fresh mutation state is inconsistent: ${JSON.stringify(initial)}`);
  }
  if (initial.mutationControlCount < 9 || initial.unlabeledMutationControls !== 0) {
    throw new Error(`Mutation controls are incomplete or unlabeled: ${JSON.stringify(initial)}`);
  }
  const parentHash = initial.recipeHash;

  await execute(`
    const setValue = (selector, value) => {
      const node = document.querySelector(selector);
      node.value = String(value);
      node.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setValue('#mutation-seed', 424242);
    setValue('#mutation-count', 3);
    setValue('#mutation-scope', 'all');
    setValue('#mutation-intensity', 'medium');
    setValue('#mutation-operation-count', 4);
    document.querySelector('#mutation-generate').click();
  `);

  const generateDeadline = Date.now() + 10_000;
  let generated = null;
  while (Date.now() < generateDeadline) {
    generated = await execute(snapshotScript);
    if (generated?.variantCount === 3 && generated?.optionCount === 4 && generated?.selectedVariant && generated?.diff.includes('\n  - ') && generated?.diff.includes('\n  + ')) break;
    await sleep(100);
  }
  if (!generated || generated.variantCount !== 3 || generated.optionCount !== 4) {
    throw new Error(`Three sibling variants were not generated: ${JSON.stringify(generated)}`);
  }
  if (!generated.selectedVariant || generated.selectedVariant === 'parent' || !generated.lineage.includes('→') || !generated.diff.includes('\n  - ') || !generated.diff.includes('\n  + ')) {
    throw new Error(`Generated sibling does not expose lineage and exact normalized diff: ${JSON.stringify(generated)}`);
  }
  if (generated.recipeHash !== parentHash) {
    throw new Error(`Generating siblings contaminated the live parent recipe: ${parentHash} -> ${generated.recipeHash}`);
  }
  const childId = generated.selectedVariant;

  await execute(`document.querySelector('#mutation-restore').click();`);
  const childDeadline = Date.now() + 10_000;
  let restoredChild = null;
  while (Date.now() < childDeadline) {
    restoredChild = await execute(snapshotScript);
    if (restoredChild?.recipeHash && restoredChild.recipeHash !== parentHash && restoredChild.optionCount === 4) break;
    await sleep(100);
  }
  if (!restoredChild || !restoredChild.recipeHash || restoredChild.recipeHash === parentHash) {
    throw new Error(`Selected child was not restored into the live editor: ${JSON.stringify(restoredChild)}`);
  }
  const childHash = restoredChild.recipeHash;

  await execute(`
    const select = document.querySelector('#mutation-variant-select');
    select.value = 'parent';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#mutation-restore').click();
  `);
  const parentDeadline = Date.now() + 10_000;
  let restoredParent = null;
  while (Date.now() < parentDeadline) {
    restoredParent = await execute(snapshotScript);
    if (restoredParent?.recipeHash === parentHash && restoredParent?.selectedVariant === 'parent') break;
    await sleep(100);
  }
  if (!restoredParent || restoredParent.recipeHash !== parentHash || restoredParent.optionCount !== 4) {
    throw new Error(`Parent restore failed or destroyed sibling family: ${JSON.stringify(restoredParent)}`);
  }

  await execute(`
    const select = document.querySelector('#mutation-variant-select');
    select.value = ${JSON.stringify(childId)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const tick = document.querySelector('#mutation-compare-tick');
    tick.value = '40';
    tick.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#mutation-compare').click();
  `);
  const comparisonDeadline = Date.now() + 20_000;
  let compared = null;
  while (Date.now() < comparisonDeadline) {
    compared = await execute(snapshotScript);
    if (compared?.comparisonCount === 4 && compared?.comparisonCards === 4 && compared?.comparisonCanvases === 4 && compared?.comparisonTick === 40) break;
    await sleep(150);
  }
  if (!compared || compared.comparisonCount !== 4 || compared.comparisonCards !== 4 || compared.comparisonCanvases !== 4 || compared.comparisonTick !== 40) {
    throw new Error(`Four-way mutation comparison did not render: ${JSON.stringify(compared)}`);
  }
  if (!compared.status.includes('independently replayed variants at tick 40')) {
    throw new Error(`Comparison did not report independent replay semantics: ${JSON.stringify(compared)}`);
  }
  if (compared.comparisonHashes.length !== 4 || compared.comparisonHashes.some((value) => !/^[0-9a-f]{16}\s+·\s+tick 40$/.test(value))) {
    throw new Error(`Comparison cards do not expose valid replay result hashes: ${JSON.stringify(compared.comparisonHashes)}`);
  }
  if (new Set(compared.comparisonHashes).size < 2) {
    throw new Error(`Parent and siblings unexpectedly produced identical comparison results: ${JSON.stringify(compared.comparisonHashes)}`);
  }

  const evidence = {
    browser,
    browserVersion: browserCapabilities.browserVersion ?? browserCapabilities.version ?? 'unknown',
    parentRecipeHash: parentHash,
    restoredChildRecipeHash: childHash,
    generatedSiblingCount: generated.variantCount,
    storedFamilyEntries: generated.optionCount,
    childIdentity: childId,
    lineage: generated.lineage,
    diffPreview: generated.diff.slice(0, 600),
    parentRestoreRecipeHash: restoredParent.recipeHash,
    comparisonTick: compared.comparisonTick,
    comparisonCount: compared.comparisonCount,
    comparisonResultHashes: compared.comparisonHashes
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
