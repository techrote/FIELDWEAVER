function element(tag, attributes = {}, text = '') {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value);
  }
  if (text) node.textContent = text;
  return node;
}

function labeled(labelText, control) {
  const label = element('label', { className: 'control-label' });
  label.append(element('span', {}, labelText), control);
  return label;
}

function button(id, text) { return element('button', { id, type: 'button', className: 'button' }, text); }
function option(value, text) { return element('option', { value: String(value) }, text); }

export function mountLutPanel(sidebar) {
  if (!(sidebar instanceof HTMLElement)) throw new TypeError('LUT panel requires the editor sidebar element.');

  const panel = element('section', { className: 'panel lut-panel', 'aria-labelledby': 'lut-title' });
  panel.append(element('h2', { id: 'lut-title' }, 'LUT logic'));
  const note = element('p', { className: 'workspace-note' }, '16-bit deterministic channels can drive preview colour and canonical material behaviour.');
  panel.append(note);

  const assetSelect = element('select', { id: 'lut-asset', 'aria-label': 'Selected LUT asset' });
  const channelSelect = element('select', { id: 'lut-channel', 'aria-label': 'Selected LUT channel' });
  const entryIndex = element('input', { id: 'lut-entry-index', type: 'number', min: '0', step: '1', value: '0' });
  const entryValue = element('input', { id: 'lut-entry-value', type: 'number', min: '0', max: '65535', step: '1', value: '0' });
  const entryApply = button('lut-entry-apply', 'Apply entry');
  panel.append(labeled('Asset', assetSelect), labeled('Channel', channelSelect));
  const entryGrid = element('div', { className: 'parameter-grid' });
  entryGrid.append(labeled('Entry index', entryIndex), labeled('16-bit value', entryValue));
  panel.append(entryGrid, entryApply);

  const generate256 = button('lut-generate-256', 'Generate 256');
  const generate512 = button('lut-generate-512', 'Generate 512');
  const generationButtons = element('div', { className: 'button-grid' });
  generationButtons.append(generate256, generate512);
  panel.append(generationButtons);

  const destination = element('select', { id: 'lut-destination', 'aria-label': 'LUT mapping destination' });
  for (const value of ['color', 'lifetimeMultiplierQ16', 'steeringMultiplierQ16', 'depositionStrengthQ16', 'radiusQ16']) {
    destination.append(option(value, value));
  }
  const source = element('select', { id: 'lut-source', 'aria-label': 'LUT mapping source' });
  for (const value of ['ageTicks', 'lifetimeProgressQ16', 'speedMagnitudeQ16', 'agentId', 'emitterId', 'spawnOrdinal', 'constant']) {
    source.append(option(value, value));
  }
  const addressMode = element('select', { id: 'lut-address-mode', 'aria-label': 'LUT address mode' });
  addressMode.append(option('clamp', 'clamp'), option('wrap', 'wrap'));
  const mappingChannel = element('select', { id: 'lut-mapping-channel', 'aria-label': 'LUT mapping channel' });
  const assignMapping = button('lut-mapping-assign', 'Assign / replace');
  const removeMapping = button('lut-mapping-remove', 'Remove mapping');
  panel.append(labeled('Destination', destination), labeled('Source', source), labeled('Address', addressMode), labeled('Mapping channel', mappingChannel));
  const mappingButtons = element('div', { className: 'button-grid' });
  mappingButtons.append(assignMapping, removeMapping);
  panel.append(mappingButtons);

  const mappingList = element('ul', { id: 'lut-mapping-list', className: 'diagnostic-list', 'aria-label': 'Current LUT mappings for selected material' });
  panel.append(mappingList);

  const json = element('textarea', { id: 'lut-json', className: 'lut-json', rows: '7', spellcheck: 'false', 'aria-label': 'LUT JSON import export text' });
  const exportJson = button('lut-export-json', 'Export JSON');
  const importJson = button('lut-import-json', 'Import JSON');
  panel.append(labeled('LUT JSON', json));
  const jsonButtons = element('div', { className: 'button-grid' });
  jsonButtons.append(exportJson, importJson);
  panel.append(jsonButtons);

  const identity = element('code', { id: 'lut-hash', className: 'hash-readout' }, '—');
  panel.append(element('p', { className: 'control-label' }, 'Selected LUT hash'), identity);

  const statusPanel = sidebar.querySelector('.compact-status');
  if (statusPanel) sidebar.insertBefore(panel, statusPanel);
  else sidebar.append(panel);

  let currentState = null;
  const updateEntry = () => {
    const selected = currentState?.selectedLut;
    if (!selected) {
      entryIndex.disabled = true;
      entryValue.disabled = true;
      entryApply.disabled = true;
      return;
    }
    entryIndex.disabled = false;
    entryValue.disabled = false;
    entryApply.disabled = false;
    const index = Math.max(0, Math.min(selected.size - 1, Math.trunc(Number(entryIndex.value) || 0)));
    entryIndex.value = String(index);
    entryIndex.max = String(selected.size - 1);
    const channel = channelSelect.value || currentState.selectedLutChannel;
    const values = selected.channels[channel];
    entryValue.value = String(values?.[index] ?? 0);
  };

  entryIndex.addEventListener('change', updateEntry);
  channelSelect.addEventListener('change', updateEntry);

  const update = (state) => {
    currentState = state;
    assetSelect.replaceChildren(...state.lutAssets.map((asset) => option(asset.id, `${asset.name} · ${asset.size}`)));
    if (state.selectedLutId !== null) assetSelect.value = String(state.selectedLutId);
    const channels = state.selectedLut ? Object.keys(state.selectedLut.channels) : [];
    channelSelect.replaceChildren(...channels.map((name) => option(name, name)));
    mappingChannel.replaceChildren(option('rgba', 'rgba (colour)'), ...channels.map((name) => option(name, name)));
    if (state.selectedLutChannel && channels.includes(state.selectedLutChannel)) {
      channelSelect.value = state.selectedLutChannel;
      mappingChannel.value = state.selectedLutChannel;
    }
    if (destination.value === 'color') mappingChannel.value = 'rgba';
    updateEntry();
    const selectedAsset = state.lutAssets.find((asset) => asset.id === state.selectedLutId);
    identity.textContent = selectedAsset?.hash ?? '—';
    const materialMappings = state.lutMappings.filter((mapping) => mapping.materialId === state.selectedMaterialId);
    mappingList.replaceChildren(...materialMappings.map((mapping) => element('li', {}, `${mapping.destination} ← LUT #${mapping.lutId}/${mapping.channel} · ${mapping.source} · ${mapping.addressMode}`)));
    if (materialMappings.length === 0) mappingList.append(element('li', {}, 'No LUT mappings for selected material.'));
    panel.dataset.ready = 'true';
  };

  destination.addEventListener('change', () => {
    if (destination.value === 'color') mappingChannel.value = 'rgba';
    else if (currentState?.selectedLutChannel) mappingChannel.value = currentState.selectedLutChannel;
  });

  return Object.freeze({
    panel,
    controls: Object.freeze({
      assetSelect, channelSelect, entryIndex, entryValue, entryApply,
      generate256, generate512, destination, source, addressMode, mappingChannel,
      assignMapping, removeMapping, mappingList, json, exportJson, importJson
    }),
    update
  });
}
