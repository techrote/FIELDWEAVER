import assert from 'node:assert/strict';
import test from 'node:test';

import { TimelineEditorSession } from '../src/editor/index.js';
import { createRecipeReplay } from '../src/recipe/index.js';
import { TimelineReplayController, earliestChangedCommandTick } from '../src/timeline/index.js';

function commands() {
  return [
    { id: 20, tick: 4, type: 'set-emitter-rate', emitterId: 1, rate: 1 },
    { id: 10, tick: 4, type: 'set-field-enabled', fieldId: 2, enabled: false },
    { id: 30, tick: 6, type: 'release-burst', emitterId: 1, count: 4 },
    { id: 40, tick: 9, type: 'set-simulation-frozen', frozen: true },
    { id: 50, tick: 11, type: 'set-simulation-frozen', frozen: false },
    { id: 60, tick: 12, type: 'set-material-parameter', materialId: 1, parameter: 'steeringNumerator', value: 2 }
  ];
}

function freshAt(recipe, tick, options = {}) {
  const replay = createRecipeReplay(recipe, { capacity: options.capacity ?? 1024, maxDepositions: options.maxDepositions ?? 50_000 });
  replay.runToTick(tick);
  return replay;
}

function assertSameCanonical(left, right, label) {
  assert.equal(left.stateHash(), right.stateHash(), `${label}: state hash`);
  assert.equal(left.depositionHash(), right.depositionHash(), `${label}: deposition hash`);
  assert.equal(left.resultHash(), right.resultHash(), `${label}: result hash`);
}

test('direct, fresh replay, backward seek and checkpoint-assisted paths reach identical canonical hashes', () => {
  const editor = new TimelineEditorSession({ agentCapacity: 1024, maxDepositions: 50_000, checkpointInterval: 4, maxCheckpoints: 8 });
  editor.setCommandTimeline(commands());
  const recipe = editor.currentRecipe();
  const controller = new TimelineReplayController(recipe, { capacity: 1024, maxDepositions: 50_000, checkpointInterval: 4, maxCheckpoints: 8 });

  for (const target of [16, 5, 21, 8, 24, 3, 12]) {
    controller.seek(target);
    assert.equal(controller.replay.simulation.tick, target);
    assertSameCanonical(controller.replay, freshAt(recipe, target), `target ${target}`);
  }

  const diagnostics = controller.diagnostics();
  assert(diagnostics.seekCount >= 7);
  assert(diagnostics.checkpointCount <= diagnostics.maxCheckpoints);
  assert(diagnostics.checkpointTicks.includes(0));
  assert(diagnostics.checkpointBytes > 0);
  assert(diagnostics.totalReplayTicks > 0);
});

test('backward seek restores a start-of-tick checkpoint and never runs the simulation numerically backward', () => {
  const editor = new TimelineEditorSession({ checkpointInterval: 3, maxCheckpoints: 10 });
  editor.setCommandTimeline(commands());
  const controller = new TimelineReplayController(editor.currentRecipe(), { checkpointInterval: 3, maxCheckpoints: 10 });
  controller.runToTick(18);
  const highHash = controller.replay.resultHash();
  controller.seek(7);
  const diagnostics = controller.diagnostics();
  assert.equal(controller.replay.simulation.tick, 7);
  assert.equal(diagnostics.lastSeek.usedCheckpoint, true);
  assert(diagnostics.lastSeek.restoredTick <= 7);
  assert.equal(diagnostics.lastSeek.replayedTicks, 7 - diagnostics.lastSeek.restoredTick);
  assert.notEqual(controller.replay.resultHash(), highHash);
  assertSameCanonical(controller.replay, freshAt(editor.currentRecipe(), 7, { capacity: 8192, maxDepositions: 250_000 }), 'backward seek');
});

test('editing an earlier command invalidates affected checkpoints and replays the edited recipe from a safe prefix', () => {
  const editor = new TimelineEditorSession({ agentCapacity: 1024, maxDepositions: 50_000, checkpointInterval: 4, maxCheckpoints: 16 });
  editor.setCommandTimeline(commands());
  const recipe = editor.currentRecipe();
  const controller = new TimelineReplayController(recipe, { capacity: 1024, maxDepositions: 50_000, checkpointInterval: 4, maxCheckpoints: 16 });
  controller.runToTick(24);
  assert.deepEqual(controller.diagnostics().checkpointTicks, [0, 4, 8, 12, 16, 20, 24]);

  const editedCommands = recipe.commands.map((command) => command.id === 30 ? { ...command, count: 9 } : command);
  assert.equal(earliestChangedCommandTick(recipe.commands, editedCommands), 6);
  const result = controller.replaceCommands(editedCommands, 24);
  assert.equal(result.earliestAffectedTick, 6);
  assert.equal(result.invalidated, 5);
  assert.equal(controller.diagnostics().lastSeek.restoredTick, 4);
  assert(controller.diagnostics().invalidations >= 5);
  assertSameCanonical(controller.replay, freshAt({ ...recipe, commands: editedCommands }, 24, { capacity: 1024, maxDepositions: 50_000 }), 'edited timeline');
});

test('checkpoint eviction changes cache performance only, never target results', () => {
  const editor = new TimelineEditorSession({ agentCapacity: 1024, maxDepositions: 50_000 });
  editor.setCommandTimeline(commands());
  const recipe = editor.currentRecipe();
  const tiny = new TimelineReplayController(recipe, { capacity: 1024, maxDepositions: 50_000, checkpointInterval: 2, maxCheckpoints: 2 });
  const roomy = new TimelineReplayController(recipe, { capacity: 1024, maxDepositions: 50_000, checkpointInterval: 2, maxCheckpoints: 20 });
  tiny.runToTick(24);
  roomy.runToTick(24);
  assert(tiny.diagnostics().evictions > 0);
  assert(tiny.diagnostics().checkpointCount <= 2);
  for (const target of [7, 19, 4, 23, 11]) {
    tiny.seek(target);
    roomy.seek(target);
    assertSameCanonical(tiny.replay, roomy.replay, `eviction target ${target}`);
    assertSameCanonical(tiny.replay, freshAt(recipe, target, { capacity: 1024, maxDepositions: 50_000 }), `fresh eviction target ${target}`);
  }
});

test('same-tick event ordering is visibly reproducible and timeline undo/redo is separate from authoring history', () => {
  const editor = new TimelineEditorSession({ agentCapacity: 1024, maxDepositions: 50_000, checkpointInterval: 4, maxCheckpoints: 8 });
  const authoringUndoDepth = editor.snapshot().history.undoDepth;
  editor.applyTimelineCommands([
    { id: 10, tick: 4, type: 'set-emitter-rate', emitterId: 1, rate: 3 },
    { id: 20, tick: 4, type: 'set-emitter-rate', emitterId: 1, rate: 0 }
  ], 'two same-tick rates');
  assert.deepEqual(editor.snapshot().commands.map((command) => command.id), [10, 20]);
  assert.equal(editor.snapshot().history.undoDepth, authoringUndoDepth);
  assert.equal(editor.snapshot().timelineHistory.undoDepth, 1);

  editor.seekTimeline(12);
  const beforeReorderTick = editor.snapshot().playheadTick;
  const movedId = editor.moveSameTickCommand(20, -1);
  assert.equal(movedId, 10);
  assert.equal(editor.snapshot().playheadTick, beforeReorderTick, 'timeline editing preserves playhead by replaying');
  assert.equal(editor.snapshot().commands[0].id, 10);
  assert.equal(editor.snapshot().commands[0].rate, 0, 'swapping numeric IDs changes the canonical same-tick order');
  assert.equal(editor.snapshot().commands[1].rate, 3);
  const reorderedHash = editor.simulation.resultHash();
  assertSameCanonical(editor._timelineController.replay, freshAt(editor.currentRecipe(), 12, { capacity: 1024, maxDepositions: 50_000 }), 'same-tick reorder');

  assert.equal(editor.undoTimeline(), true);
  assert.equal(editor.snapshot().playheadTick, 12);
  assert.equal(editor.snapshot().commands[0].rate, 3);
  assert.notEqual(editor.simulation.resultHash(), reorderedHash);
  assert.equal(editor.snapshot().history.undoDepth, authoringUndoDepth);
  assert.equal(editor.redoTimeline(), true);
  assert.equal(editor.snapshot().commands[0].rate, 0);
  assert.equal(editor.simulation.resultHash(), reorderedHash);
});
