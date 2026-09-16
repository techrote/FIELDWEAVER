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

  if (text) {
    node.textContent = text;
  }

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
    const name = element('strong', {}, subsystem.label);
    const badge = element('span', { className: 'status-badge' }, subsystem.state);
    const detail = element('p', {}, `${subsystem.issue}: ${subsystem.detail}`);

    heading.append(name, badge);
    item.append(heading, detail);
    list.append(item);
  }

  return list;
}

function diagnosticsText(snapshot) {
  const viewport = `${window.innerWidth}×${window.innerHeight}`;
  const connection = navigator.onLine ? 'available (not required)' : 'offline';

  return [
    `Version: ${snapshot.version}`,
    `Phase: ${snapshot.phase}`,
    `Runtime: ${snapshot.runtime}`,
    `Canonical mode: ${snapshot.canonicalMode}`,
    `External network: ${snapshot.externalNetworkRequired ? 'required' : 'not required'}`,
    `Browser network state: ${connection}`,
    `Viewport: ${viewport}`
  ];
}

export function mountApplicationShell(root, snapshot) {
  if (!(root instanceof HTMLElement)) {
    throw new TypeError('FIELDWEAVER shell root must be an HTMLElement.');
  }

  const shell = element('div', { className: 'app-shell' });
  const header = element('header', { className: 'masthead' });
  const brand = element('div');
  const eyebrow = element('p', { className: 'eyebrow' }, `${snapshot.phase} · foundation`);
  const title = element('h1', {}, snapshot.product);
  const subtitle = element(
    'p',
    { className: 'subtitle' },
    'Paint behaviours, not pixels. The runtime foundation is live; simulation features remain explicitly unimplemented.'
  );
  brand.append(eyebrow, title, subtitle);

  const version = element('div', { className: 'version-chip', 'aria-label': `Application version ${snapshot.version}` }, `v${snapshot.version}`);
  header.append(brand, version);

  const main = element('main', { id: 'main', className: 'workspace-grid', tabindex: '-1' });
  const workspace = element('section', { className: 'workspace-card', 'aria-labelledby': 'workspace-title' });
  const workspaceTitle = element('h2', { id: 'workspace-title' }, 'Workspace');
  const canvasPlaceholder = element('div', { className: 'canvas-placeholder', role: 'img', 'aria-label': 'Reserved workspace for future deterministic field and renderer implementation' });
  const fieldGlyph = element('div', { className: 'field-glyph', 'aria-hidden': 'true' }, '⇝  ⟳  ⋰  ⤢');
  const placeholderText = element('p', {}, 'Renderer and direct field tools arrive in later roadmap issues. Nothing here is presented as simulated output.');
  canvasPlaceholder.append(fieldGlyph, placeholderText);
  workspace.append(workspaceTitle, canvasPlaceholder);

  const sidebar = element('aside', { className: 'sidebar', 'aria-label': 'Runtime status and diagnostics' });
  const statusPanel = element('section', { className: 'panel', 'aria-labelledby': 'status-title' });
  statusPanel.append(element('h2', { id: 'status-title' }, 'Subsystem status'), buildStatusList(snapshot));

  const diagnosticPanel = element('section', { className: 'panel', 'aria-labelledby': 'diagnostic-title' });
  const diagnosticTitle = element('h2', { id: 'diagnostic-title' }, 'Diagnostics');
  const diagnosticList = element('ul', { className: 'diagnostic-list', 'aria-live': 'polite' });
  const refreshButton = element('button', { type: 'button', className: 'button' }, 'Refresh diagnostics');

  const renderDiagnostics = () => {
    diagnosticList.replaceChildren(
      ...diagnosticsText(snapshot).map((line) => element('li', {}, line))
    );
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
    element('span', {}, 'Headless core boundary preserved')
  );

  shell.append(header, main, footer);
  root.replaceChildren(shell);

  return Object.freeze({ refreshDiagnostics: renderDiagnostics });
}
