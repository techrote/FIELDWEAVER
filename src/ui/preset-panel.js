import { getActiveRecipeEditorSession } from '../editor/index.js';
import { BUILTIN_PRESETS, getBuiltinPreset } from '../presets/index.js';
import { compareExhibitionProofs, exhibitionEntries, nextExhibitionId, renderExhibitionProof } from './exhibition-catalog.js';
import { mountExhibitionInspector } from './exhibition-inspector.js';

function element(tag, attributes = {}, text = '') {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') node.className = value;
    else node.setAttribute(key, value);
  }
  if (text) node.textContent = text;
  return node;
}

function publishPresetMetadata(preset) {
  document.documentElement.dataset.fieldweaverPresetId = preset.id;
  document.documentElement.dataset.fieldweaverPresetRecipeHash = preset.recipeHash;
  document.documentElement.dataset.fieldweaverPresetTargetTick = String(preset.targetTick);
}

function download(bytes, mime, filename) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = element('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function copyAcceptedCropToExportPanel(preset) {
  const crop = preset.exportCrop;
  const values = {
    'export-width': crop.widthPx,
    'export-height': crop.heightPx,
    'export-tick': preset.targetTick,
    'export-units-per-pixel-q16': crop.unitsPerPixelQ16,
    'export-center-chunk-x': crop.center.chunkX,
    'export-center-chunk-y': crop.center.chunkY,
    'export-center-local-x': crop.center.localX,
    'export-center-local-y': crop.center.localY
  };
  let copied = 0;
  for (const [id, value] of Object.entries(values)) {
    const input = document.getElementById(id);
    if (input) {
      input.value = String(value);
      copied += 1;
    }
  }
  return copied === Object.keys(values).length;
}

export function mountPresetPanel(parent) {
  if (!(parent instanceof HTMLElement)) throw new TypeError('Preset panel parent must be an HTMLElement.');
  const panel = element('section', { className: 'panel preset-panel exhibition-panel', 'aria-labelledby': 'preset-title' });
  panel.append(element('h2', { id: 'preset-title' }, 'Exhibition · accepted presets'));
  panel.append(element('p', { className: 'workspace-note' }, 'Browse the four shipped, golden-tested recipes. Render an actual canonical CPU proof at its recorded tick and crop, or load the recipe into the editor. Previews are generated locally on demand.'));

  const entries = exhibitionEntries();
  const grid = element('div', { id: 'exhibition-grid', className: 'exhibition-grid', role: 'group', 'aria-label': 'Accepted compositions' });
  const cards = new Map();
  for (const entry of entries) {
    const card = element('button', {
      type: 'button', className: 'exhibition-card', 'data-exhibition-id': entry.id,
      'aria-pressed': 'false', 'aria-label': 'Select ' + entry.name
    });
    card.append(element('strong', {}, entry.name), element('span', {}, 'tick ' + entry.targetTick + ' · seed ' + entry.seed));
    grid.append(card);
    cards.set(entry.id, card);
  }
  panel.append(grid);

  const navigation = element('div', { className: 'exhibition-nav' });
  const previous = element('button', { id: 'exhibition-prev', type: 'button', className: 'button' }, 'Previous');
  const next = element('button', { id: 'exhibition-next', type: 'button', className: 'button' }, 'Next');
  navigation.append(previous, next);
  panel.append(navigation);

  // Keep the FW-014 preset selection/automation contract unchanged.
  const label = element('label', { className: 'control-label' });
  const select = element('select', { id: 'preset-select', 'aria-describedby': 'preset-description' });
  for (const preset of BUILTIN_PRESETS) select.append(element('option', { value: preset.id }, preset.name));
  label.append(element('span', {}, 'Selected work'), select);
  panel.append(label);

  const description = element('p', { id: 'preset-description', className: 'workspace-note exhibition-description' });
  const coverage = element('p', { id: 'preset-coverage', className: 'workspace-note' });
  const identity = element('dl', { className: 'exhibition-identity', 'aria-label': 'Reproducible artwork identity' });
  const detailFields = [
    ['Seed', 'exhibition-seed'],
    ['Recipe hash', 'exhibition-recipe-hash'],
    ['Target tick', 'exhibition-tick'],
    ['Canonical crop', 'exhibition-crop'],
    ['Lineage', 'exhibition-lineage']
  ];
  const values = new Map();
  for (const [labelText, id] of detailFields) {
    const title = element('dt', {}, labelText);
    const value = element('dd', { id });
    values.set(id, value);
    identity.append(title, value);
  }
  panel.append(description, coverage, identity);

  const figure = element('figure', { className: 'exhibition-figure' });
  const preview = element('img', { id: 'exhibition-preview', alt: 'Canonical proof not yet generated.' });
  preview.hidden = true;
  const placeholder = element('p', { id: 'exhibition-placeholder', className: 'workspace-note' }, 'No image generated. Select Render canonical proof to compute the actual CPU raster.');
  const caption = element('figcaption', { id: 'exhibition-caption', className: 'workspace-note' }, 'Canonical output only · no WebGL or fabricated imagery');
  figure.append(preview, placeholder, caption);
  panel.append(figure);

  const renderButton = element('button', { id: 'exhibition-render', type: 'button', className: 'button' }, 'Render canonical proof');
  const load = element('button', { id: 'preset-load', type: 'button', className: 'button' }, 'Load preset');
  const pngDownload = element('button', { id: 'exhibition-download-png', type: 'button', className: 'button' }, 'Download proof PNG');
  const provenanceDownload = element('button', { id: 'exhibition-download-provenance', type: 'button', className: 'button' }, 'Download provenance');
  pngDownload.disabled = true;
  provenanceDownload.disabled = true;
  const actions = element('div', { className: 'exhibition-actions' });
  actions.append(renderButton, load, pngDownload, provenanceDownload);
  const proofIdentity = element('code', { id: 'exhibition-proof-hash', className: 'hash-readout' }, 'Proof: not rendered');
  const status = element('output', { id: 'preset-status', className: 'hash-readout', 'aria-live': 'polite' }, 'Ready');
  panel.append(actions, proofIdentity, status);

  // An explicit pinned proof survives gallery navigation; B always means the
  // currently rendered selection. Neither side ever samples the WebGL view.
  const comparePanel = element('section', { className: 'exhibition-compare', 'aria-labelledby': 'exhibition-compare-title' });
  comparePanel.append(element('h3', { id: 'exhibition-compare-title' }, 'Compare canonical works'));
  comparePanel.append(element('p', { className: 'workspace-note' }, 'Render a work and pin it as A. Select another work, render its own canonical proof as B, and compare their exact identities and framing. Your editor remains untouched.'));
  const pinButton = element('button', { id: 'exhibition-pin-a', type: 'button', className: 'button' }, 'Pin rendered proof as A');
  const clearPinButton = element('button', { id: 'exhibition-clear-a', type: 'button', className: 'button' }, 'Clear A');
  const downloadPinPng = element('button', { id: 'exhibition-a-download-png', type: 'button', className: 'button' }, 'Download A PNG');
  const downloadPinProvenance = element('button', { id: 'exhibition-a-download-provenance', type: 'button', className: 'button' }, 'Download A provenance');
  const inspectButton = element('button', { id: 'exhibition-inspect', type: 'button', className: 'button' }, 'Inspect larger / compare');
  inspectButton.disabled = true;
  pinButton.disabled = true;
  clearPinButton.disabled = true;
  downloadPinPng.disabled = true;
  downloadPinProvenance.disabled = true;
  const pinActions = element('div', { className: 'exhibition-compare-actions' });
  pinActions.append(pinButton, clearPinButton, downloadPinPng, downloadPinProvenance, inspectButton);
  comparePanel.append(pinActions);
  const compareGrid = element('div', { className: 'exhibition-compare-grid', role: 'group', 'aria-label': 'Canonical comparison A and B' });
  const makeSlot = (letter) => {
    const figure = element('figure', { className: 'exhibition-compare-slot' });
    const title = element('strong', {}, letter + ' · not rendered');
    const image = element('img', { id: 'exhibition-compare-' + letter.toLowerCase() + '-image', alt: '' });
    image.hidden = true;
    const empty = element('p', { className: 'workspace-note' }, letter === 'A' ? 'Pin a rendered proof.' : 'Render the selected work after pinning A.');
    const details = element('figcaption', { className: 'workspace-note', id: 'exhibition-compare-' + letter.toLowerCase() + '-details' });
    figure.append(title, image, empty, details);
    compareGrid.append(figure);
    return { title, image, empty, details };
  };
  const slotA = makeSlot('A');
  const slotB = makeSlot('B');
  comparePanel.append(compareGrid);
  const compareStatus = element('output', { id: 'exhibition-compare-status', className: 'workspace-note', 'aria-live': 'polite' }, 'No work pinned.');
  comparePanel.append(compareStatus);
  panel.append(comparePanel);

  const recipePanel = parent.querySelector('#recipe-title')?.closest('.panel');
  if (recipePanel) parent.insertBefore(panel, recipePanel);
  else parent.prepend(panel);

  let currentProof = null;
  let previewUrl = null;
  let previewGeneration = 0;
  let pinnedProof = null;
  let pinnedUrl = null;
  const inspector = mountExhibitionInspector();

  const getEditor = () => {
    const editor = getActiveRecipeEditorSession();
    if (!editor || typeof editor.adoptRecipe !== 'function') throw new Error('Recipe-aware editor is not initialized yet.');
    return editor;
  };

  const setStatus = (text) => {
    status.value = text;
    status.textContent = text;
  };


  const showSlot = (slot, letter, proof, url) => {
    if (!proof || !url) {
      slot.title.textContent = letter + ' · not rendered';
      slot.image.hidden = true;
      slot.image.removeAttribute('src');
      slot.empty.hidden = false;
      slot.details.textContent = '';
      return;
    }
    const preset = getBuiltinPreset(proof.presetId);
    const crop = proof.crop;
    slot.title.textContent = letter + ' · ' + preset.name;
    slot.image.src = url;
    slot.image.alt = 'Canonical software-raster output of ' + preset.name + ' at tick ' + proof.targetTick;
    slot.image.hidden = false;
    slot.empty.hidden = true;
    slot.details.textContent = 'Seed ' + (preset.recipe.seed >>> 0) +
      ' · tick ' + proof.targetTick +
      ' · ' + crop.widthPx + '×' + crop.heightPx +
      ' · Q16 units/px ' + crop.unitsPerPixelQ16 +
      ' · chunk ' + crop.center.chunkX + ',' + crop.center.chunkY +
      ' · recipe ' + proof.recipeHash +
      ' · RGBA8 ' + proof.rawRgbaHash;
  };

  const refreshComparison = () => {
    showSlot(slotA, 'A', pinnedProof, pinnedUrl);
    showSlot(slotB, 'B', pinnedProof ? currentProof : null, previewUrl);
    pinButton.disabled = !currentProof;
    clearPinButton.disabled = !pinnedProof;
    downloadPinPng.disabled = !pinnedProof;
    downloadPinProvenance.disabled = !pinnedProof;
    inspectButton.disabled = !pinnedProof && !currentProof;
    if (!pinnedProof) {
      compareStatus.textContent = 'No work pinned. Render a canonical proof and pin it as A.';
    } else if (!currentProof) {
      compareStatus.textContent = 'A is pinned independently. Select and render a work for B.';
    } else {
      const result = compareExhibitionProofs(pinnedProof, currentProof);
      compareStatus.textContent = (result.sameRawRgbaHash ? 'Matching' : 'Distinct') +
        ' raw RGBA8 identities · ' + (result.sameRecipe ? 'same accepted recipe' : 'different accepted recipes') +
        ' · ' + (result.sameCrop ? 'same crop' : 'individual authored crops') +
        '. No cross-work resampling or inferred visual similarity.';
    }
  };

  const clearProof = () => {
    inspector.close(); // Never keep an inspection open across stale/revoked PNG URLs.
    previewGeneration += 1;
    currentProof = null;
    pngDownload.disabled = true;
    provenanceDownload.disabled = true;
    proofIdentity.textContent = 'Proof: not rendered';
    preview.hidden = true;
    preview.removeAttribute('src');
    placeholder.hidden = false;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    document.documentElement.dataset.fieldweaverExhibitionProofHash = '';
    refreshComparison();
  };

  const refresh = () => {
    const preset = getBuiltinPreset(select.value);
    description.textContent = preset.description;
    coverage.textContent = 'Covers: ' + preset.coverage.join(' · ');
    values.get('exhibition-seed').textContent = String(preset.recipe.seed >>> 0);
    values.get('exhibition-recipe-hash').textContent = preset.recipeHash;
    values.get('exhibition-tick').textContent = String(preset.targetTick);
    const crop = preset.exportCrop;
    values.get('exhibition-crop').textContent = crop.widthPx + '×' + crop.heightPx + ' · Q16 units/px ' + crop.unitsPerPixelQ16 + ' · chunk ' + crop.center.chunkX + ',' + crop.center.chunkY;
    values.get('exhibition-lineage').textContent = preset.recipe.lineage ? 'Derived from ' + preset.recipe.lineage.parentRecipeHash : 'Original preset';
    for (const [id, card] of cards) card.setAttribute('aria-pressed', id === preset.id ? 'true' : 'false');
    preview.alt = 'Canonical software-raster proof of ' + preset.name + ' at tick ' + preset.targetTick;
    caption.textContent = preset.name + ' · target tick ' + preset.targetTick + ' · canonical software raster only';
    publishPresetMetadata(preset);
    clearProof();
    setStatus('Selected ' + preset.name + '; render to inspect canonical pixels.');
    return preset;
  };

  select.addEventListener('change', refresh);
  grid.addEventListener('click', (event) => {
    const card = event.target.closest('[data-exhibition-id]');
    if (!card) return;
    select.value = card.dataset.exhibitionId;
    refresh();
  });
  previous.addEventListener('click', () => {
    select.value = nextExhibitionId(select.value, -1);
    refresh();
  });
  next.addEventListener('click', () => {
    select.value = nextExhibitionId(select.value, 1);
    refresh();
  });

  renderButton.addEventListener('click', () => {
    const id = select.value;
    const generation = ++previewGeneration;
    renderButton.disabled = true;
    setStatus('Replaying tick ' + getBuiltinPreset(id).targetTick + ' and rasterizing canonical pixels…');
    // Give the live region one browser frame to show progress before synchronous CPU replay.
    requestAnimationFrame(() => {
      try {
        if (generation !== previewGeneration || id !== select.value) return;
        const proof = renderExhibitionProof(id);
        if (generation !== previewGeneration || id !== select.value) return;
        clearProof();
        currentProof = proof;
        previewUrl = URL.createObjectURL(new Blob([proof.png], { type: 'image/png' }));
        preview.src = previewUrl;
        preview.hidden = false;
        placeholder.hidden = true;
        proofIdentity.textContent = 'Raw RGBA8: ' + proof.rawRgbaHash + ' · state ' + proof.stateHash;
        document.documentElement.dataset.fieldweaverExhibitionProofHash = proof.rawRgbaHash;
        pngDownload.disabled = false;
        provenanceDownload.disabled = false;
        refreshComparison();
        setStatus('Canonical proof ready: ' + proof.rawRgbaHash);
      } catch (error) {
        clearProof();
        setStatus('Canonical proof failed: ' + (error?.message ?? String(error)));
      } finally {
        renderButton.disabled = false;
      }
    });
  });

  load.addEventListener('click', () => {
    try {
      const preset = getBuiltinPreset(select.value);
      const editor = getEditor();
      editor.adoptRecipe(preset.recipe);
      window.dispatchEvent(new CustomEvent('fieldweaver:recipe-adopted', { detail: { source: 'preset', id: preset.id } }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      const copied = copyAcceptedCropToExportPanel(preset);
      setStatus('Loaded ' + preset.name + ' · ' + preset.recipeHash + (copied ? ' · exact exhibition crop and tick sent to Canonical export' : ' · use the exhibition crop and tick above for export'));
      publishPresetMetadata(preset);
    } catch (error) {
      setStatus('Preset rejected: ' + (error?.message ?? String(error)));
    }
  });

  pngDownload.addEventListener('click', () => {
    if (currentProof && currentProof.presetId === select.value) {
      download(currentProof.png, 'image/png', 'fieldweaver-' + currentProof.presetId + '-' + currentProof.rawRgbaHash + '.png');
    }
  });
  provenanceDownload.addEventListener('click', () => {
    if (currentProof && currentProof.presetId === select.value) {
      download(new TextEncoder().encode(currentProof.provenanceJson), 'application/json', 'fieldweaver-' + currentProof.presetId + '-' + currentProof.rawRgbaHash + '.fwexport.json');
    }
  });

  pinButton.addEventListener('click', () => {
    if (!currentProof || currentProof.presetId !== select.value) return;
    inspector.close();
    const url = URL.createObjectURL(new Blob([currentProof.png], { type: 'image/png' }));
    if (pinnedUrl) URL.revokeObjectURL(pinnedUrl);
    pinnedProof = currentProof;
    pinnedUrl = url;
    refreshComparison();
  });
  clearPinButton.addEventListener('click', () => {
    inspector.close();
    if (pinnedUrl) URL.revokeObjectURL(pinnedUrl);
    pinnedProof = null;
    pinnedUrl = null;
    refreshComparison();
  });
  inspectButton.addEventListener('click', () => {
    try {
      inspector.open({ pinnedProof, pinnedUrl, currentProof, currentUrl: previewUrl });
    } catch (error) {
      setStatus('Inspection unavailable: ' + (error?.message ?? String(error)));
    }
  });
  downloadPinPng.addEventListener('click', () => {
    if (pinnedProof) download(pinnedProof.png, 'image/png',
      'fieldweaver-' + pinnedProof.presetId + '-' + pinnedProof.rawRgbaHash + '.png');
  });
  downloadPinProvenance.addEventListener('click', () => {
    if (pinnedProof) download(new TextEncoder().encode(pinnedProof.provenanceJson), 'application/json',
      'fieldweaver-' + pinnedProof.presetId + '-' + pinnedProof.rawRgbaHash + '.fwexport.json');
  });
  window.addEventListener('pagehide', () => {
    inspector.close();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (pinnedUrl) URL.revokeObjectURL(pinnedUrl);
    previewUrl = null;
    pinnedUrl = null;
  }, { once: true });

  refresh();
  panel.dataset.ready = 'true';
  return Object.freeze({ panel, select, load, status, description, coverage, grid, renderButton, preview, pngDownload, provenanceDownload, comparePanel, pinButton, clearPinButton, inspectButton, inspector, slotA, slotB });
}

function mountWhenReady(attempt = 0) {
  const parent = document.querySelector('.editor-sidebar');
  if (parent) {
    mountPresetPanel(parent);
    return;
  }
  if (attempt < 120) requestAnimationFrame(() => mountWhenReady(attempt + 1));
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', () => mountWhenReady(), { once: true });
else mountWhenReady();
