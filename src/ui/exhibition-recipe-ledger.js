import { canonicalHash, canonicalStringify } from '../core/canonical.js';
import { getBuiltinPreset } from '../presets/index.js';
import { recipeHash } from '../recipe/index.js';
import { exhibitionEntries } from './exhibition-catalog.js';

export const RECIPE_LEDGER_VERSION = 'fw-exhibition-recipe-ledger-v1';

function row(key, title, value, description) {
  return Object.freeze({ key, title, description, fingerprint: canonicalHash(value) });
}

function cropDescription(crop) {
  const { center } = crop;
  return crop.widthPx + '×' + crop.heightPx + ', Q16 units/px ' + crop.unitsPerPixelQ16 +
    ', centre (' + [center.chunkX, center.chunkY, center.localX, center.localY].join(', ') + ')';
}

// Authoring facts only: no pixels, image similarity, or re-execution here.
// Every source comes from the accepted immutable built-in preset catalog.
export function acceptedRecipeLedger(id) {
  const preset = getBuiltinPreset(id);
  const recipe = preset.recipe;
  if (recipeHash(recipe) !== preset.recipeHash) throw new Error('Accepted recipe identity mismatch.');
  const fields = recipe.fields.layers;
  const lut = recipe.lut;
  const timeline = [...recipe.commands].sort((a, b) => a.tick - b.tick || a.id - b.id);
  const score = Object.freeze([
    row('compatibility', 'Recipe compatibility', [recipe.schemaVersion, recipe.engineVersion],
      recipe.schemaVersion + ' · ' + recipe.engineVersion),
    row('seed', 'Root seed', recipe.seed, String(recipe.seed >>> 0)),
    row('tick', 'Canonical target tick', preset.targetTick, String(preset.targetTick)),
    row('crop', 'Authored export crop', preset.exportCrop, cropDescription(preset.exportCrop)),
    row('fields', 'Ordered field stack', recipe.fields,
      fields.length + ' layers · ' + (fields.map((f) => '#' + f.id + ' ' + f.operator + (f.enabled ? '' : ' (off)')).join(' → ') || 'none')),
    row('materials', 'Material behaviours', recipe.materials,
      recipe.materials.length + ' materials · ' + recipe.materials.map((m) => '#' + m.id + ' ' + m.kind).join(', ')),
    row('emitters', 'Emitter schedules', recipe.emitters,
      recipe.emitters.length + ' emitters · ' + recipe.emitters.map((e) =>
        '#' + e.id + ' material ' + e.materialId + ' t' + e.startTick + '–' + e.stopTick).join(', ')),
    row('lut', 'LUT logic', lut,
      lut.assets.length + ' assets · ' + lut.mappings.length + ' mappings'),
    row('commands', 'Interventions', recipe.commands,
      timeline.length + ' commands · ' + (timeline.length ? 'ticks ' +
        [...new Set(timeline.map((c) => c.tick))].join(', ') : 'none')),
    row('lineage', 'Lineage', recipe.lineage,
      recipe.lineage ? 'Parent ' + recipe.lineage.parentRecipeHash +
        ' · child seed ' + recipe.lineage.childSeed + ' · ' + recipe.lineage.operations.length + ' operations' : 'Original accepted preset')
  ]);
  return Object.freeze({
    version: RECIPE_LEDGER_VERSION,
    id: preset.id,
    title: preset.name,
    recipeHash: preset.recipeHash,
    rows: score,
    commands: Object.freeze(timeline.map((command) => Object.freeze({
      tick: command.tick, id: command.id, type: command.type, canonical: canonicalStringify(command)
    })))
  });
}

export function compareAcceptedRecipeLedgers(a, b = null) {
  if (!a || a.version !== RECIPE_LEDGER_VERSION ||
      !Array.isArray(a.rows) || (b && (b.version !== RECIPE_LEDGER_VERSION || !Array.isArray(b.rows)))) {
    throw new TypeError('Only accepted recipe ledgers may be compared.');
  }
  const other = b ? new Map(b.rows.map((entry) => [entry.key, entry])) : null;
  if (other && (other.size !== a.rows.length || a.rows.some((entry) => !other.has(entry.key)))) {
    throw new Error('Incompatible recipe ledger dimensions.');
  }
  return Object.freeze(a.rows.map((entry) => Object.freeze({
    key: entry.key, title: entry.title, left: entry.description,
    right: other ? other.get(entry.key).description : null,
    relation: other ? (entry.fingerprint === other.get(entry.key).fingerprint ? 'Identical' : 'Different') : 'Single work',
    leftFingerprint: entry.fingerprint,
    rightFingerprint: other ? other.get(entry.key).fingerprint : null
  })));
}

function el(tag, attributes = {}, text = '') {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  node.textContent = text;
  return node;
}

function readStudyFrame(frame, prefix, accepted) {
  if (!frame || frame.hidden) return null;
  const heading = frame.querySelector('h3')?.textContent ?? '';
  if (!heading.startsWith(prefix + ' · ')) return null;
  const title = heading.slice((prefix + ' · ').length);
  const entry = accepted.find((item) => item.name === title);
  const img = frame.querySelector('img');
  const card = entry && document.querySelector('[data-exhibition-id="' + entry.id + '"]');
  const rawRgbaHash = card?.dataset.canonicalRgbaHash;
  if (!entry || !img?.complete || img.naturalWidth !== entry.exportCrop.widthPx ||
      img.naturalHeight !== entry.exportCrop.heightPx ||
      !img.currentSrc.startsWith('blob:') || !/^[a-f0-9]{16}$/.test(rawRgbaHash ?? '')) return null;
  return Object.freeze({ id: entry.id, rawRgbaHash });
}

export function mountExhibitionRecipeLedger(dialog) {
  if (!(dialog instanceof HTMLDialogElement)) throw new TypeError('A gallery study dialog is required.');
  if (dialog.querySelector('#exhibition-recipe-ledger')) return;
  const status = dialog.querySelector('#exhibition-study-status');
  const frames = dialog.querySelectorAll('.exhibition-study-frame');
  if (!status || frames.length !== 2) throw new Error('The canonical study must mount before the recipe ledger.');

  const accepted = exhibitionEntries();
  const wrapper = el('details', { id: 'exhibition-recipe-ledger', class: 'exhibition-recipe-ledger' });
  wrapper.hidden = true;
  wrapper.append(el('summary', {}, 'Inspect recipe score / differences'));
  const intro = el('p', { class: 'workspace-note', id: 'exhibition-recipe-ledger-help' },
    'Read-only authoring facts from accepted recipes. Fingerprints compare exact normalized settings, not artistic similarity. Images remain canonical CPU proofs.');
  const table = el('table', { class: 'exhibition-ledger-table', 'aria-label': 'Accepted recipe A/B differences' });
  const head = el('thead');
  const headRow = el('tr');
  for (const label of ['Dimension', 'A · accepted recipe', 'B · accepted recipe', 'Exact relation']) headRow.append(el('th', { scope: 'col' }, label));
  head.append(headRow);
  const body = el('tbody', { id: 'exhibition-recipe-ledger-rows' });
  table.append(head, body);
  const commands = el('div', { id: 'exhibition-recipe-ledger-commands', class: 'exhibition-ledger-commands' });
  const download = el('button', { type: 'button', id: 'exhibition-recipe-ledger-download', class: 'button' },
    'Save reproduction / comparison record (.json)');
  const note = el('output', { id: 'exhibition-recipe-ledger-status', class: 'workspace-note', 'aria-live': 'polite' });
  wrapper.append(intro, table, commands, download, note);
  dialog.insertBefore(wrapper, status);

  let report = null;
  function render() {
    if (!dialog.open) { wrapper.hidden = true; report = null; return; }
    const left = readStudyFrame(frames[0], 'A', accepted);
    const right = readStudyFrame(frames[1], 'B', accepted);
    if (!left || (!frames[1].hidden && !right)) {
      wrapper.hidden = true; report = null; return;
    }
    const a = acceptedRecipeLedger(left.id), b = right ? acceptedRecipeLedger(right.id) : null;
    const comparison = compareAcceptedRecipeLedgers(a, b);
    body.replaceChildren();
    for (const entry of comparison) {
      const tr = el('tr');
      if (entry.relation === 'Different') tr.className = 'exhibition-ledger-different';
      tr.append(el('th', { scope: 'row' }, entry.title),
        el('td', {}, entry.left + ' · ' + entry.leftFingerprint),
        el('td', {}, entry.right === null ? '—' : entry.right + ' · ' + entry.rightFingerprint),
        el('td', {}, entry.relation));
      body.append(tr);
    }
    commands.replaceChildren();
    for (const [letter, score] of [['A', a], ['B', b]]) {
      if (!score) continue;
      const section = el('section');
      section.append(el('h3', {}, letter + ' · ' + score.title + ' · intervention register'));
      if (!score.commands.length) section.append(el('p', { class: 'workspace-note' }, 'No intervention commands.'));
      else {
        const list = el('ol');
        for (const event of score.commands) list.append(el('li', {},
          'tick ' + event.tick + ' · command #' + event.id + ' · ' + event.canonical));
        section.append(list);
      }
      commands.append(section);
    }
    report = Object.freeze({
      version: RECIPE_LEDGER_VERSION,
      claim: 'Accepted local CPU proofs; authoring comparison only; no inferred visual similarity',
      a: Object.freeze({ ...left, score: a }),
      b: right ? Object.freeze({ ...right, score: b }) : null,
      comparison
    });
    wrapper.hidden = false;
    note.textContent = right ? 'Two accepted recipes compared; images are individually framed.' : 'One accepted recipe inspected.';
  }
  const observer = new MutationObserver(render);
  observer.observe(status, { childList: true, characterData: true, subtree: true });
  dialog.addEventListener('close', render);
  download.addEventListener('click', () => {
    if (!report || !dialog.open) return;
    const blob = new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: 'fieldweaver-recipe-score-' + report.a.id +
      (report.b ? '-vs-' + report.b.id : '') + '.json' });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  render();
}

function mountWhenReady(attempt = 0) {
  const dialog = document.querySelector('#exhibition-study-dialog');
  if (dialog) return mountExhibitionRecipeLedger(dialog);
  if (attempt < 180) requestAnimationFrame(() => mountWhenReady(attempt + 1));
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', () => mountWhenReady(), { once: true });
  else mountWhenReady();
}
