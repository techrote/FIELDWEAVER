function element(tag, attributes = {}, text = '') {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') {
      node.className = value;
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else {
      node.setAttribute(key, value);
    }
  }

  if (text) node.textContent = text;
  return node;
}

function buildStatusList(snapshot) {
  const list = element('ul', { className: 'status-list' });
  for (const subsystem of snapshot.subsystemStatus) {
    const item = element('li', {
      className: 'status-row',
      dataset: { state: subsystem.state }
    });
    const heading = element('div', { className: 'status-row__heading' });
    heading.append(
      element('strong', {}, subsystem.label),
      element('span', { className: 'status-badge' }, subsystem.state)
    );
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
  if (!diagnostics || diagnostics.state !== 'ready') {
    return [`Renderer: ${diagnostics?.state ?? 'not initialized'}`];
  }
  const view = diagnostics.viewport;
  return [
    'Renderer: WebGL2 preview (noncanonical)',
    `Frame: ${diagnostics.frameMs.toFixed(2)} ms (prepare ${diagnostics.prepareMs.toFixed(2)} / submit ${diagnostics.submitMs.toFixed(2)})`,
    `Draw calls: ${diagnostics.drawCalls}`,
    `Artwork vertices: ${diagnostics.pointVertices + diagnostics.lineVertices}`,
    `Overlay vertices: ${diagnostics.overlayVertices}`,
    `Transient buffer: ${(diagnostics.bufferBytes / 1024).toFixed(1)} KiB`,
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

export function mountApplicationShell(root, snapshot) {
  if (!(root instanceof HTMLElement)) throw new TypeError('FIELDWEAVER shell root must be an HTMLElement.');

  let rendererDiagnostics = null;
  const shell = element('div', { className: 'app-shell' });
  const header = element('header', { className: 'masthead' });
  const brand = element('div');
  const eyebrow = element('p', { className: 'eyebrow' }, `${snapshot.phase} · deterministic simulation + noncanonical preview`);
  const title = element('h1', {}, snapshot.product);
  const subtitle = element(
    'p',
    { className: 'subtitle' },
    'Canonical agent/deposition state is rendered by a read-only WebGL2 preview. GPU output is intentionally not the canonical pixel oracle.'
  );
  brand.append(eyebrow, title, subtitle);
  header.append(
    brand,
    element('div', { className: 'version-chip', 'aria-label': `Application version ${snapshot.version}` }, `v${snapshot.version}`)
  );

  const main = element('main', { id: 'main', className: 'workspace-grid', tabindex: '-1' });
  const workspace = element('section', { className: 'workspace-card', 'aria-labelledby': 'workspace-title' });
  const workspaceHeading = element('div', { className: 'workspace-heading' });
  const workspaceTitleBlock = element('div');
  workspaceTitleBlock.append(
    element('h2', { id: 'workspace-title' }, 'Live deposition preview'),
    element('p', { className: 'workspace-note' }, 'Drag to pan · wheel to zoom · overlays are view-only. Seeded FW-005 demo shown until the editor lands in FW-007.')
  );
  workspaceHeading.append(workspaceTitleBlock, buildLegend());

  const previewFrame = element('div', { className: 'preview-frame' });
  const canvas = element('canvas', {
    id: 'preview-canvas',
    className: 'preview-canvas',
    tabindex: '0',
    role: 'img',
    'aria-label': 'WebGL2 preview of deterministic Ink, Filament, Dust, and Shard deposition records'
  });
  const rendererMessage = element('p', { className: 'renderer-message', role: 'status', 'aria-live': 'polite' }, 'Initializing WebGL2 preview…');
  previewFrame.append(canvas, rendererMessage);
  workspace.append(workspaceHeading, previewFrame);

  const sidebar = element('aside', { className: 'sidebar', 'aria-label': 'Runtime status and diagnostics' });
  const statusPanel = element('section', { className: 'panel', 'aria-labelledby': 'status-title' });
  statusPanel.append(element('h2', { id: 'status-title' }, 'Subsystem status'), buildStatusList(snapshot));

  const diagnosticPanel = element('section', { className: 'panel', 'aria-labelledby': 'diagnostic-title' });
  const diagnosticTitle = element('h2', { id: 'diagnostic-title' }, 'Diagnostics');
  const diagnosticList = element('ul', { className: 'diagnostic-list', 'aria-live': 'polite' });
  const refreshButton = element('button', { type: 'button', className: 'button' }, 'Refresh diagnostics');

  const renderDiagnostics = () => {
    const lines = [...baseDiagnosticsText(snapshot), ...rendererDiagnosticsText(rendererDiagnostics)];
    diagnosticList.replaceChildren(...lines.map((line) => element('li', {}, line)));
  };

  const updateRendererDiagnostics = (diagnostics) => {
    rendererDiagnostics = diagnostics;
    if (diagnostics?.state === 'ready') {
      rendererMessage.hidden = true;
      rendererMessage.textContent = '';
      rendererMessage.setAttribute('role', 'status');
    }
    renderDiagnostics();
  };

  const setRendererError = (message) => {
    rendererDiagnostics = Object.freeze({ state: 'unavailable' });
    rendererMessage.hidden = false;
    rendererMessage.textContent = message;
    rendererMessage.setAttribute('role', 'alert');
    renderDiagnostics();
  };

  refreshButton.addEventListener('click', renderDiagnostics);
  window.addEventListener('online', renderDiagnostics);
  window.addEventListener('offline', renderDiagnostics);
  window.addEventListener('resize', renderDiagnostics, { passive: true });

  renderDiagnostics();
  diagnosticPanel.append(diagnosticTitle, diagnosticList, refreshButton);
  sidebar.append(statusPanel, diagnosticPanel);
  main.append(workspace, sidebar);

  const footer = element('footer', { className: 'footer' });
  footer.append(
    element('span', {}, 'Local-first · no external service dependency'),
    element('span', {}, 'Canonical simulation remains DOM/GPU-free')
  );

  shell.append(header, main, footer);
  root.replaceChildren(shell);

  return Object.freeze({ canvas, refreshDiagnostics: renderDiagnostics, updateRendererDiagnostics, setRendererError });
}
