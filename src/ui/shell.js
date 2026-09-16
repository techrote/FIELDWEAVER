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

function labeledControl(labelText, control) {
  const label = element('label', { className: 'control-label' });
  label.append(element('span', {}, labelText), control);
  return label;
}

function button(id, text, className = 'button') {
  return element('button', { id, type: 'button', className }, text);
}

function buildStatusList(snapshot) {
  const list = element('ul', { className: 'status-list' });
  for (const subsystem of snapshot.subsystemStatus) {
    const item = element('li', { className: 'status-row', dataset: { state: subsystem.state } });
    const heading = element('div', { className: 'status-row__heading' });
    heading.append(element('strong', {}, subsystem.label), element('span', { className: 'status-badge' }, subsystem.state));
    item.append(heading, element('p', {}, `${subsystem.issue}: ${subsystem.detail}`));
    list.append(item);
  }
  return list;
}

function baseDiagnosticsText(snapshot) {
  const viewport = `${window.innerWidth}×${window.innerHeight}`;
  const connection = navigator.onLine ? 'available (not required)' : 'offline';
  return [
    `Version: ${snapshot.version}`,
    `Phase: ${snapshot.phase}`,
    `Runtime: ${snapshot.runtime}`,
    `Canonical mode: ${snapshot.canonicalMode}`,
    `External network: ${snapshot.externalNetworkRequired ? 'required' : 'not required'}`,
    `Browser network state: ${connection}`,
    `Browser viewport: ${viewport}`
  ];
}

function rendererDiagnosticsText(diagnostics) {
  if (!diagnostics || diagnostics.state !== 'ready') return [`Renderer: ${diagnostics?.state ?? 'not initialized'}`];
  const view = diagnostics.viewport;
  return [
    'Renderer: WebGL2 preview (noncanonical)',
    `Frame: ${diagnostics.frameMs.toFixed(2)} ms (prepare ${diagnostics.prepareMs.toFixed(2)} / submit ${diagnostics.submitMs.toFixed(2)})`,
    `Geometry cache: ${diagnostics.geometryRebuilt ? 'rebuilt' : 'reused'} · rebuilds ${diagnostics.geometryRebuildCount} · build ${diagnostics.geometryBuildMs.toFixed(2)} ms`,
    `Draw calls: ${diagnostics.drawCalls}`,
    `Artwork vertices: ${diagnostics.pointVertices + diagnostics.lineVertices}`,
    `Overlay vertices: ${diagnostics.overlayVertices}`,
    `Prepared geometry: ${(diagnostics.cachedArtworkBytes / 1024).toFixed(1)} KiB artwork + ${(diagnostics.overlayBufferBytes / 1024).toFixed(1)} KiB overlays`,
    `GPU upload this frame: ${(diagnostics.gpuUploadBytes / 1024).toFixed(1)} KiB`,
    `Preview deposition window: ${diagnostics.previewDepositions}/${diagnostics.previewCapacity}${diagnostics.previewTruncated ? ` · ${diagnostics.previewDropped} older records omitted` : ''}`,
    `Preview viewport: ${view.widthCssPx}×${view.heightCssPx} CSS px @ ${view.devicePixelRatio.toFixed(2)} DPR · zoom ${view.zoom.toFixed(2)}`,
    `Framebuffer: ${diagnostics.framebuffer.width}×${diagnostics.framebuffer.height}`,
    `GPU: ${diagnostics.renderer} · ${diagnostics.vendor}`
  ];
}

function buildLegend() {
  const legend = element('ul', { className: 'material-legend', 'aria-label': 'Material preview legend' });
  for (const [kind, label] of [['ink', 'Ink'], ['filament', 'Filament'], ['dust', 'Dust'], ['shard', 'Shard']]) {
    const item = element('li', { dataset: { material: kind } });
    item.append(element('span', { className: 'legend-swatch', 'aria-hidden': 'true' }), element('span', {}, label));
    legend.append(item);
  }
  return legend;
}

function option(value, text) {
  return element('option', { value: String(value) }, text);
}

export function mountApplicationShell(root, snapshot) {
  if (!(root instanceof HTMLElement)) throw new TypeError('FIELDWEAVER shell root must be an HTMLElement.');

  let rendererDiagnostics = null;
  let editorSnapshot = null;
  document.documentElement.dataset.fieldweaverRendererState = 'initializing';
  document.documentElement.dataset.fieldweaverEditorState = 'initializing';

  const shell = element('div', { className: 'app-shell' });
  const header = element('header', { className: 'masthead' });
  const brand = element('div');
  brand.append(
    element('p', { className: 'eyebrow' }, `${snapshot.phase} · deterministic instrument editor`),
    element('h1', {}, snapshot.product),
    element('p', { className: 'subtitle' }, 'Paint deterministic vector fields, place emitters, tune materials, and run the canonical fixed-step simulation. WebGL remains a read-only preview.')
  );
  header.append(brand, element('div', { className: 'version-chip', 'aria-label': `Application version ${snapshot.version}` }, `v${snapshot.version}`));

  const main = element('main', { id: 'main', className: 'editor-grid', tabindex: '-1' });
  const workspace = element('section', { className: 'workspace-card editor-workspace', 'aria-labelledby': 'workspace-title' });
  const workspaceHeading = element('div', { className: 'workspace-heading' });
  const titleBlock = element('div');
  titleBlock.append(
    element('h2', { id: 'workspace-title' }, 'Instrument canvas'),
    element('p', { className: 'workspace-note' }, 'Pan [P] · Paint [B] · Erase [E] · move field [V] · place emitter [N] · move emitter [M] · Space run/pause · . step')
  );
  workspaceHeading.append(titleBlock, buildLegend());

  const toolBar = element('div', { className: 'toolbar', role: 'toolbar', 'aria-label': 'Canvas tools' });
  const toolButtons = {};
  for (const [tool, label, shortcut] of [
    ['pan', 'Pan', 'P'], ['paint', 'Paint', 'B'], ['erase', 'Erase', 'E'],
    ['move-field', 'Move field', 'V'], ['place-emitter', 'Place emitter', 'N'], ['move-emitter', 'Move emitter', 'M']
  ]) {
    const control = button(`tool-${tool}`, `${label} [${shortcut}]`, 'button tool-button');
    control.dataset.tool = tool;
    control.setAttribute('aria-pressed', 'false');
    toolButtons[tool] = control;
    toolBar.append(control);
  }

  const transport = element('div', { className: 'transport', 'aria-label': 'Simulation transport' });
  const runButton = button('run-toggle', 'Run [Space]');
  const stepButton = button('step-once', 'Step [.]');
  const multiStepButton = button('step-many', 'Multi-step [Shift+.]');
  const resetButton = button('simulation-reset', 'Reset [R]');
  const speedSelect = element('select', { id: 'speed-select', 'aria-label': 'Simulation speed' });
  for (const speed of [0.25, 0.5, 1, 2, 4, 8]) speedSelect.append(option(speed, `${speed}×`));
  const multiStepInput = element('input', { id: 'multi-step-count', type: 'number', min: '1', max: '100000', step: '1', value: '8' });
  const tickReadout = element('output', { id: 'tick-readout', className: 'tick-readout', 'aria-live': 'polite' }, 'Tick 0');
  transport.append(runButton, stepButton, multiStepButton, resetButton, labeledControl('Speed', speedSelect), labeledControl('Multi', multiStepInput), tickReadout);

  const previewFrame = element('div', { className: 'preview-frame editor-preview-frame' });
  const canvas = element('canvas', {
    id: 'preview-canvas', className: 'preview-canvas', tabindex: '0', role: 'application',
    'aria-label': 'FIELDWEAVER editable WebGL2 canvas. Use the selected tool with pointer or keyboard controls.'
  });
  const overlayCanvas = element('canvas', { id: 'editor-overlay', className: 'editor-overlay', 'aria-hidden': 'true' });
  const rendererMessage = element('p', { className: 'renderer-message', role: 'status', 'aria-live': 'polite' }, 'Initializing WebGL2 preview…');
  const canvasStatus = element('output', { id: 'canvas-status', className: 'canvas-status', 'aria-live': 'polite' }, 'Editor initializing…');
  previewFrame.append(canvas, overlayCanvas, rendererMessage, canvasStatus);
  workspace.append(workspaceHeading, toolBar, transport, previewFrame);

  const sidebar = element('aside', { className: 'sidebar editor-sidebar', 'aria-label': 'FIELDWEAVER editor controls' });

  const fieldsPanel = element('section', { className: 'panel', 'aria-labelledby': 'fields-title' });
  const fieldsTitle = element('h2', { id: 'fields-title' }, 'Field stack');
  const fieldList = element('div', { id: 'field-list', className: 'field-list', role: 'listbox', 'aria-label': 'Ordered field layers' });
  const newFieldOperator = element('select', { id: 'new-field-operator', 'aria-label': 'New field operator' });
  for (const name of ['uniform', 'attractor', 'vortex', 'turbulence', 'direction-quantizer']) newFieldOperator.append(option(name, name));
  const addFieldButton = button('field-add', 'Add field');
  const deleteFieldButton = button('field-delete', 'Delete selected');
  const fieldUpButton = button('field-up', 'Move up');
  const fieldDownButton = button('field-down', 'Move down');
  const fieldEnabled = element('input', { id: 'field-enabled', type: 'checkbox' });
  const fieldParamGrid = element('div', { id: 'field-parameters', className: 'parameter-grid' });
  fieldsPanel.append(fieldsTitle, fieldList, element('div', { className: 'inline-controls' }, ''), labeledControl('New operator', newFieldOperator));
  fieldsPanel.append(element('div', { className: 'button-grid' }, ''));
  fieldsPanel.querySelector('.button-grid').append(addFieldButton, deleteFieldButton, fieldUpButton, fieldDownButton);
  fieldsPanel.append(labeledControl('Enabled', fieldEnabled), fieldParamGrid);

  const brushPanel = element('section', { className: 'panel', 'aria-labelledby': 'brush-title' });
  brushPanel.append(element('h2', { id: 'brush-title' }, 'Brush'));
  const brushRadius = element('input', { id: 'brush-radius', type: 'range', min: '0', max: '32', step: '1', value: '4' });
  const brushX = element('input', { id: 'brush-x', type: 'number', step: '0.05', min: '-4', max: '4', value: '0.5' });
  const brushY = element('input', { id: 'brush-y', type: 'number', step: '0.05', min: '-4', max: '4', value: '0' });
  const undoButton = button('authoring-undo', 'Undo [Ctrl+Z]');
  const redoButton = button('authoring-redo', 'Redo [Ctrl+Y]');
  brushPanel.append(labeledControl('Radius', brushRadius), labeledControl('Vector X', brushX), labeledControl('Vector Y', brushY));
  const historyButtons = element('div', { className: 'button-grid' });
  historyButtons.append(undoButton, redoButton);
  brushPanel.append(historyButtons);

  const emitterPanel = element('section', { className: 'panel', 'aria-labelledby': 'emitter-title' });
  emitterPanel.append(element('h2', { id: 'emitter-title' }, 'Emitters'));
  const emitterSelect = element('select', { id: 'emitter-select', 'aria-label': 'Selected emitter' });
  const emitterMaterial = element('select', { id: 'emitter-material', 'aria-label': 'Emitter material' });
  const emitterRate = element('input', { id: 'emitter-rate', type: 'number', min: '0', max: '65535', step: '1', value: '1' });
  const emitterAdd = button('emitter-add', 'Add at view center');
  const emitterDelete = button('emitter-delete', 'Delete');
  emitterPanel.append(labeledControl('Emitter', emitterSelect), labeledControl('Material', emitterMaterial), labeledControl('Rate / interval', emitterRate));
  const emitterButtons = element('div', { className: 'button-grid' });
  emitterButtons.append(emitterAdd, emitterDelete);
  emitterPanel.append(emitterButtons);

  const materialPanel = element('section', { className: 'panel', 'aria-labelledby': 'material-title' });
  materialPanel.append(element('h2', { id: 'material-title' }, 'Material'));
  const materialSelect = element('select', { id: 'material-select', 'aria-label': 'Selected material' });
  const materialLifetime = element('input', { id: 'material-lifetime', type: 'number', min: '1', step: '1' });
  const materialDepositEvery = element('input', { id: 'material-deposit-every', type: 'number', min: '1', step: '1' });
  const materialSteering = element('input', { id: 'material-steering', type: 'number', min: '0', step: '1' });
  materialPanel.append(labeledControl('Material', materialSelect), labeledControl('Lifetime ticks', materialLifetime), labeledControl('Deposit every', materialDepositEvery), labeledControl('Steering numerator', materialSteering));

  const seedPanel = element('section', { className: 'panel', 'aria-labelledby': 'seed-title' });
  seedPanel.append(element('h2', { id: 'seed-title' }, 'Seed & identity'));
  const seedInput = element('input', { id: 'seed-input', type: 'number', min: '0', max: '4294967295', step: '1' });
  const seedApply = button('seed-apply', 'Apply seed');
  const seedRandom = button('seed-random', 'New recorded seed');
  const recipeHash = element('code', { id: 'recipe-hash', className: 'hash-readout' }, '—');
  seedPanel.append(labeledControl('Root seed', seedInput));
  const seedButtons = element('div', { className: 'button-grid' });
  seedButtons.append(seedApply, seedRandom);
  seedPanel.append(seedButtons, element('p', { className: 'control-label' }, 'Authoring hash'), recipeHash);

  const diagnosticPanel = element('section', { className: 'panel', 'aria-labelledby': 'diagnostic-title' });
  const diagnosticList = element('ul', { className: 'diagnostic-list', 'aria-live': 'polite' });
  const refreshButton = button('diagnostics-refresh', 'Refresh diagnostics');
  diagnosticPanel.append(element('h2', { id: 'diagnostic-title' }, 'Diagnostics'), diagnosticList, refreshButton);

  const statusPanel = element('section', { className: 'panel compact-status', 'aria-labelledby': 'status-title' });
  statusPanel.append(element('h2', { id: 'status-title' }, 'Subsystem status'), buildStatusList(snapshot));
  sidebar.append(fieldsPanel, brushPanel, emitterPanel, materialPanel, seedPanel, diagnosticPanel, statusPanel);
  main.append(workspace, sidebar);

  const footer = element('footer', { className: 'footer' });
  footer.append(element('span', {}, 'Local-first · canonical edits are model operations'), element('span', {}, 'WebGL/DOM timing never defines simulation truth'));
  shell.append(header, main, footer);
  root.replaceChildren(shell);

  const controls = Object.freeze({
    toolButtons, runButton, stepButton, multiStepButton, resetButton, speedSelect, multiStepInput,
    fieldList, newFieldOperator, addFieldButton, deleteFieldButton, fieldUpButton, fieldDownButton, fieldEnabled, fieldParamGrid,
    brushRadius, brushX, brushY, undoButton, redoButton,
    emitterSelect, emitterMaterial, emitterRate, emitterAdd, emitterDelete,
    materialSelect, materialLifetime, materialDepositEvery, materialSteering,
    seedInput, seedApply, seedRandom, refreshButton
  });

  const renderDiagnostics = () => {
    const editorLines = editorSnapshot ? [
      `Editor: ${editorSnapshot.running ? 'running' : 'paused'} · tick ${editorSnapshot.tick} · ${editorSnapshot.speedMultiplier}×`,
      `Simulation: ${editorSnapshot.activeAgents} active agents · ${editorSnapshot.depositions} depositions · ${editorSnapshot.droppedSpawns} dropped spawns`,
      `Scheduler backlog: ${editorSnapshot.backlogTicks} ticks`,
      `Authoring: ${editorSnapshot.fields.length} fields · ${editorSnapshot.emitters.length} emitters · undo ${editorSnapshot.history.undoDepth} / redo ${editorSnapshot.history.redoDepth}`
    ] : ['Editor: initializing'];
    const lines = [...baseDiagnosticsText(snapshot), ...editorLines, ...rendererDiagnosticsText(rendererDiagnostics)];
    diagnosticList.replaceChildren(...lines.map((line) => element('li', {}, line)));
  };

  const updateRendererDiagnostics = (diagnostics) => {
    rendererDiagnostics = diagnostics;
    if (diagnostics?.state === 'ready') {
      document.documentElement.dataset.fieldweaverRendererState = 'ready';
      rendererMessage.hidden = true;
      rendererMessage.textContent = '';
      rendererMessage.setAttribute('role', 'status');
    }
    renderDiagnostics();
  };

  const setRendererError = (message) => {
    rendererDiagnostics = Object.freeze({ state: 'unavailable' });
    document.documentElement.dataset.fieldweaverRendererState = 'unavailable';
    rendererMessage.hidden = false;
    rendererMessage.textContent = message;
    rendererMessage.setAttribute('role', 'alert');
    renderDiagnostics();
  };

  const updateEditorState = (state) => {
    editorSnapshot = state;
    document.documentElement.dataset.fieldweaverEditorState = 'ready';
    document.documentElement.dataset.fieldweaverCanonicalRecipeHash = state.authoringHash;
    document.documentElement.dataset.fieldweaverEditorTick = String(state.tick);
    document.documentElement.dataset.fieldweaverEditorFields = String(state.fields.length);
    document.documentElement.dataset.fieldweaverEditorEmitters = String(state.emitters.length);

    for (const [tool, control] of Object.entries(toolButtons)) {
      const active = tool === state.tool;
      control.setAttribute('aria-pressed', active ? 'true' : 'false');
      control.dataset.active = active ? 'true' : 'false';
    }
    runButton.textContent = state.running ? 'Pause [Space]' : 'Run [Space]';
    runButton.setAttribute('aria-pressed', state.running ? 'true' : 'false');
    speedSelect.value = String(state.speedMultiplier);
    multiStepInput.value = String(state.multiStepCount);
    tickReadout.value = `Tick ${state.tick}${state.backlogTicks ? ` · backlog ${state.backlogTicks}` : ''}`;
    tickReadout.textContent = tickReadout.value;
    canvasStatus.value = `${state.tool} · ${state.running ? 'running' : 'paused'} · tick ${state.tick}`;
    canvasStatus.textContent = canvasStatus.value;

    fieldList.replaceChildren(...state.fields.map((field) => {
      const control = button(`field-${field.id}`, `#${field.id} ${field.operator}${field.enabled ? '' : ' (off)'}`, 'field-item');
      control.dataset.fieldId = String(field.id);
      control.setAttribute('role', 'option');
      control.setAttribute('aria-selected', field.id === state.selectedFieldId ? 'true' : 'false');
      return control;
    }));
    fieldEnabled.checked = state.selectedField?.enabled ?? false;
    deleteFieldButton.disabled = state.fields.length <= 1;
    undoButton.disabled = state.history.undoDepth === 0;
    redoButton.disabled = state.history.redoDepth === 0;
    fieldParamGrid.replaceChildren();
    if (state.selectedField) {
      for (const [name, value] of Object.entries(state.selectedField.parameters)) {
        const input = element('input', { type: 'number', step: '1', value: String(value), dataset: { fieldParam: name } });
        fieldParamGrid.append(labeledControl(name, input));
      }
    }

    emitterSelect.replaceChildren(...state.emitters.map((emitter) => option(emitter.id, `#${emitter.id}`)));
    emitterSelect.disabled = state.emitters.length === 0;
    if (state.selectedEmitterId !== null) emitterSelect.value = String(state.selectedEmitterId);
    emitterDelete.disabled = state.emitters.length === 0;

    const materialOptions = state.materials.map((material) => option(material.id, `${material.kind} #${material.id}`));
    materialSelect.replaceChildren(...materialOptions.map((entry) => entry.cloneNode(true)));
    emitterMaterial.replaceChildren(...materialOptions);
    if (state.selectedMaterialId !== null) materialSelect.value = String(state.selectedMaterialId);
    if (state.selectedEmitter) {
      emitterMaterial.value = String(state.selectedEmitter.materialId);
      emitterRate.value = String(state.selectedEmitter.rate);
    }
    if (state.selectedMaterial) {
      materialLifetime.value = String(state.selectedMaterial.lifetimeTicks);
      materialDepositEvery.value = String(state.selectedMaterial.depositEvery);
      materialSteering.value = String(state.selectedMaterial.steeringNumerator);
    }
    seedInput.value = String(state.rootSeed >>> 0);
    recipeHash.textContent = state.authoringHash;
    renderDiagnostics();
  };

  refreshButton.addEventListener('click', renderDiagnostics);
  window.addEventListener('online', renderDiagnostics);
  window.addEventListener('offline', renderDiagnostics);
  window.addEventListener('resize', renderDiagnostics, { passive: true });
  renderDiagnostics();

  return Object.freeze({
    canvas,
    overlayCanvas,
    controls,
    refreshDiagnostics: renderDiagnostics,
    updateRendererDiagnostics,
    setRendererError,
    updateEditorState
  });
}
