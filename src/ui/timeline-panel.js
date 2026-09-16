import { getActiveRecipeEditorSession } from '../editor/index.js';
import { COMMAND_TYPES } from '../recipe/index.js';

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

export function mountTimelinePanel(parent) {
  if (!(parent instanceof HTMLElement)) throw new TypeError('Timeline panel parent must be an HTMLElement.');
  const panel = element('section', { className: 'panel timeline-panel', 'aria-labelledby': 'timeline-title' });
  panel.append(element('h2', { id: 'timeline-title' }, 'Timeline'));
  panel.append(element('p', { className: 'workspace-note' }, 'Backward seeks restore a checkpoint or recipe start, then replay forward. Simulation physics is never numerically reversed.'));

  const playhead = element('input', { id: 'timeline-playhead', type: 'range', min: '0', max: '256', step: '1', value: '0', 'aria-label': 'Timeline playhead tick' });
  const targetTick = element('input', { id: 'timeline-target-tick', type: 'number', min: '0', max: '4294967295', step: '1', value: '0' });
  const seek = button('timeline-seek', 'Seek');
  const currentTick = element('output', { id: 'timeline-current-tick', className: 'hash-readout', 'aria-live': 'polite' }, 'Tick 0');
  panel.append(labeled('Playhead', playhead));
  const seekGrid = element('div', { className: 'parameter-grid' });
  seekGrid.append(labeled('Target tick', targetTick), seek);
  panel.append(seekGrid, currentTick);

  const viewStart = element('input', { id: 'timeline-view-start', type: 'number', min: '0', max: '4294967295', step: '1', value: '0' });
  const viewSpan = element('select', { id: 'timeline-view-span', 'aria-label': 'Timeline visible tick span' });
  for (const span of [64, 256, 1024, 4096]) viewSpan.append(option(span, `${span} ticks`));
  viewSpan.value = '256';
  const rangeGrid = element('div', { className: 'parameter-grid' });
  rangeGrid.append(labeled('View start', viewStart), labeled('View span', viewSpan));
  panel.append(rangeGrid);

  const eventList = element('div', { id: 'timeline-events', className: 'field-list timeline-events', role: 'listbox', 'aria-label': 'Timeline command events' });
  panel.append(eventList);

  const addType = element('select', { id: 'timeline-add-type', 'aria-label': 'New timeline command type' });
  for (const type of COMMAND_TYPES) addType.append(option(type, type));
  const addTick = element('input', { id: 'timeline-add-tick', type: 'number', min: '0', max: '4294967295', step: '1', value: '0' });
  const add = button('timeline-add', 'Add event');
  panel.append(labeled('New event type', addType), labeled('New event tick', addTick), add);

  const commandJson = element('textarea', {
    id: 'timeline-command-json', className: 'lut-json', rows: '8', spellcheck: 'false',
    'aria-label': 'Selected timeline command JSON'
  });
  const apply = button('timeline-apply', 'Apply edit');
  const remove = button('timeline-remove', 'Delete event');
  const earlier = button('timeline-earlier', 'Earlier same tick');
  const later = button('timeline-later', 'Later same tick');
  panel.append(labeled('Selected event JSON', commandJson));
  const editButtons = element('div', { className: 'button-grid' });
  editButtons.append(apply, remove, earlier, later);
  panel.append(editButtons);

  const undo = button('timeline-undo', 'Timeline undo');
  const redo = button('timeline-redo', 'Timeline redo');
  const historyButtons = element('div', { className: 'button-grid' });
  historyButtons.append(undo, redo);
  panel.append(historyButtons);

  const diagnostics = element('ul', { id: 'timeline-diagnostics', className: 'diagnostic-list', 'aria-live': 'polite' });
  const status = element('output', { id: 'timeline-status', className: 'hash-readout', 'aria-live': 'polite' }, 'Ready');
  panel.append(diagnostics, status);

  const statusPanel = parent.querySelector('.compact-status');
  if (statusPanel) parent.insertBefore(panel, statusPanel);
  else parent.append(panel);

  let currentState = null;
  let selectedCommandId = null;

  const getEditor = () => {
    const editor = getActiveRecipeEditorSession();
    if (!editor || typeof editor.seekTimeline !== 'function') throw new Error('Timeline-aware editor is not initialized yet.');
    return editor;
  };

  const signalRefresh = () => window.dispatchEvent(new CustomEvent('fieldweaver-editor-refresh'));

  const act = (callback, message = 'Timeline updated') => {
    try {
      const result = callback(getEditor());
      status.value = message;
      status.textContent = message;
      signalRefresh();
      return result;
    } catch (error) {
      const text = `Timeline rejected: ${error?.message ?? String(error)}`;
      status.value = text;
      status.textContent = text;
      return null;
    }
  };

  const visibleRange = () => {
    const start = Math.max(0, Math.trunc(Number(viewStart.value) || 0));
    const span = Math.max(1, Math.trunc(Number(viewSpan.value) || 256));
    return { start, end: Math.min(0xffffffff, start + span) };
  };

  const selectCommand = (id) => {
    selectedCommandId = id;
    const command = currentState?.commands.find((entry) => entry.id === id) ?? null;
    commandJson.value = command ? `${JSON.stringify(command, null, 2)}\n` : '';
  };

  const render = (state) => {
    if (!state || !state.timelineDiagnostics) return;
    currentState = state;
    const span = Math.max(1, Math.trunc(Number(viewSpan.value) || 256));
    let start = Math.max(0, Math.trunc(Number(viewStart.value) || 0));
    if (state.playheadTick < start || state.playheadTick > start + span) {
      start = Math.floor(state.playheadTick / span) * span;
      viewStart.value = String(start);
    }
    playhead.min = String(start);
    playhead.max = String(Math.min(0xffffffff, start + span));
    playhead.value = String(Math.max(start, Math.min(start + span, state.playheadTick)));
    targetTick.value = String(state.playheadTick);
    addTick.value = String(state.playheadTick);
    currentTick.value = `Tick ${state.playheadTick}${state.timelineFrozen ? ' · frozen' : ''}`;
    currentTick.textContent = currentTick.value;

    const range = visibleRange();
    const visible = state.commands.filter((command) => command.tick >= range.start && command.tick <= range.end);
    eventList.replaceChildren(...visible.map((command) => {
      const control = button(`timeline-event-${command.id}`, `T${command.tick} · #${command.id} · ${command.type}`, 'field-item');
      control.dataset.commandId = String(command.id);
      control.setAttribute('role', 'option');
      control.setAttribute('aria-selected', command.id === selectedCommandId ? 'true' : 'false');
      return control;
    }));
    if (visible.length === 0) eventList.append(element('p', { className: 'workspace-note' }, 'No events in visible range.'));
    if (selectedCommandId !== null && !state.commands.some((command) => command.id === selectedCommandId)) selectCommand(null);
    else if (selectedCommandId !== null) selectCommand(selectedCommandId);

    undo.disabled = state.timelineHistory.undoDepth === 0;
    redo.disabled = state.timelineHistory.redoDepth === 0;
    const d = state.timelineDiagnostics;
    const last = d.lastSeek;
    diagnostics.replaceChildren(
      element('li', {}, `Checkpoints: ${d.checkpointCount}/${d.maxCheckpoints} every ${d.checkpointInterval} ticks · ${(d.checkpointBytes / 1024).toFixed(1)} KiB est.`),
      element('li', {}, `Cache: ${d.evictions} evictions · ${d.invalidations} invalidations`),
      element('li', {}, `Replay: ${d.seekCount} seeks · ${d.totalReplayTicks} replayed ticks`),
      element('li', {}, last ? `Last seek: ${last.startTick} → ${last.targetTick} via ${last.restoredTick} (${last.replayedTicks} ticks)` : 'Last seek: none')
    );
    panel.dataset.ready = 'true';
  };

  eventList.addEventListener('click', (event) => {
    const control = event.target.closest('[data-command-id]');
    if (!control) return;
    selectCommand(Number(control.dataset.commandId));
    if (currentState) render(currentState);
  });
  playhead.addEventListener('change', () => act((editor) => editor.seekTimeline(Number(playhead.value)), `Seeked to tick ${playhead.value}`));
  seek.addEventListener('click', () => act((editor) => editor.seekTimeline(Number(targetTick.value)), `Seeked to tick ${targetTick.value}`));
  viewStart.addEventListener('change', () => currentState && render(currentState));
  viewSpan.addEventListener('change', () => currentState && render(currentState));
  add.addEventListener('click', () => act((editor) => {
    const command = editor.draftTimelineCommand(addType.value, Number(addTick.value));
    editor.addTimelineCommand(command);
    selectedCommandId = command.id;
    return command;
  }, 'Timeline event added'));
  apply.addEventListener('click', () => act((editor) => {
    if (selectedCommandId === null) throw new RangeError('Select a timeline event first.');
    const replacement = JSON.parse(commandJson.value);
    editor.updateTimelineCommand(selectedCommandId, replacement);
    selectedCommandId = replacement.id;
  }, 'Timeline event updated'));
  remove.addEventListener('click', () => act((editor) => {
    if (selectedCommandId === null) throw new RangeError('Select a timeline event first.');
    editor.removeTimelineCommand(selectedCommandId);
    selectedCommandId = null;
  }, 'Timeline event deleted'));
  earlier.addEventListener('click', () => act((editor) => {
    if (selectedCommandId === null) throw new RangeError('Select a timeline event first.');
    selectedCommandId = editor.moveSameTickCommand(selectedCommandId, -1);
  }, 'Timeline event moved earlier'));
  later.addEventListener('click', () => act((editor) => {
    if (selectedCommandId === null) throw new RangeError('Select a timeline event first.');
    selectedCommandId = editor.moveSameTickCommand(selectedCommandId, 1);
  }, 'Timeline event moved later'));
  undo.addEventListener('click', () => act((editor) => editor.undoTimeline(), 'Timeline edit undone'));
  redo.addEventListener('click', () => act((editor) => editor.redoTimeline(), 'Timeline edit redone'));

  window.addEventListener('fieldweaver-editor-state', (event) => render(event.detail));
  try { render(getEditor().snapshot()); } catch { /* app initialization will publish state shortly */ }

  return Object.freeze({ panel, render, controls: Object.freeze({ playhead, targetTick, seek, viewStart, viewSpan, eventList, addType, addTick, add, commandJson, apply, remove, earlier, later, undo, redo, diagnostics, status }) });
}

function mountWhenReady(attempt = 0) {
  const parent = document.querySelector('.editor-sidebar');
  if (parent) {
    mountTimelinePanel(parent);
    return;
  }
  if (attempt < 120) requestAnimationFrame(() => mountWhenReady(attempt + 1));
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', () => mountWhenReady(), { once: true });
else mountWhenReady();
