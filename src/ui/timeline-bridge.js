import { getActiveRecipeEditorSession } from '../editor/index.js';

function activeEditor() {
  const editor = getActiveRecipeEditorSession();
  return editor && typeof editor.seekTimeline === 'function' ? editor : null;
}

function publishTimelineState() {
  const editor = activeEditor();
  if (!editor) return null;
  const state = editor.snapshot();
  window.dispatchEvent(new CustomEvent('fieldweaver-editor-state', { detail: state }));
  document.documentElement.dataset.fieldweaverTimelineTick = String(state.playheadTick);
  document.documentElement.dataset.fieldweaverTimelineCheckpoints = String(state.timelineDiagnostics?.checkpointCount ?? 0);
  return state;
}

function publishWhenReady(attempt = 0) {
  if (publishTimelineState()) return;
  if (attempt < 120) setTimeout(() => publishWhenReady(attempt + 1), 25);
}

window.addEventListener('fieldweaver-editor-refresh', () => {
  const editor = activeEditor();
  if (!editor) return;
  // Timeline seeks/edits pause first. Toggling the existing transport twice clears its
  // private scheduler backlog without advancing a canonical tick or duplicating clock logic.
  const runButton = document.querySelector('#run-toggle');
  if (!editor.running && runButton instanceof HTMLButtonElement) {
    runButton.click();
    runButton.click();
  }
  window.dispatchEvent(new Event('resize'));
  publishTimelineState();
});

let previousSignature = '';
setInterval(() => {
  const editor = activeEditor();
  if (!editor) return;
  const state = editor.snapshot();
  const diagnostics = state.timelineDiagnostics;
  const signature = [
    state.playheadTick,
    state.authoringHash,
    state.running ? 1 : 0,
    state.timelineHistory.undoDepth,
    state.timelineHistory.redoDepth,
    diagnostics?.checkpointCount ?? 0,
    diagnostics?.evictions ?? 0,
    diagnostics?.invalidations ?? 0,
    diagnostics?.seekCount ?? 0,
    diagnostics?.totalReplayTicks ?? 0
  ].join('|');
  if (signature === previousSignature) return;
  previousSignature = signature;
  window.dispatchEvent(new CustomEvent('fieldweaver-editor-state', { detail: state }));
  document.documentElement.dataset.fieldweaverTimelineTick = String(state.playheadTick);
  document.documentElement.dataset.fieldweaverTimelineCheckpoints = String(diagnostics?.checkpointCount ?? 0);
}, 100);

publishWhenReady();
