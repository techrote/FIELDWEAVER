import { assertUint32 } from '../core/numeric.js';
import { applyBrushPatch, createBrushPatch } from './brush.js';

function freezeCommand(command) {
  if (!command || typeof command.redo !== 'function' || typeof command.undo !== 'function') {
    throw new TypeError('Authoring command must provide redo(model) and undo(model).');
  }
  return command;
}

export class AuthoringHistory {
  constructor(maxEntries = 128) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 4096) throw new RangeError('maxEntries must be an integer in [1, 4096].');
    this.maxEntries = maxEntries;
    this._undo = [];
    this._redo = [];
  }
  get undoDepth() { return this._undo.length; }
  get redoDepth() { return this._redo.length; }

  execute(command, model) {
    const normalized = freezeCommand(command);
    normalized.redo(model);
    this._undo.push(normalized);
    if (this._undo.length > this.maxEntries) this._undo.splice(0, this._undo.length - this.maxEntries);
    this._redo.length = 0;
  }

  undo(model) {
    const command = this._undo.pop();
    if (!command) return false;
    command.undo(model);
    this._redo.push(command);
    return true;
  }

  redo(model) {
    const command = this._redo.pop();
    if (!command) return false;
    command.redo(model);
    this._undo.push(command);
    return true;
  }

  clear() {
    this._undo.length = 0;
    this._redo.length = 0;
  }
}

export function createBrushCommand(collection, layerId, stroke, brush) {
  assertUint32(layerId, 'layerId');
  const layer = collection.getLayer(layerId);
  const patch = createBrushPatch(layer, stroke, brush);
  return Object.freeze({
    kind: 'field-cell-patch',
    layerId,
    patch,
    redo(model) { applyBrushPatch(model.getLayer(layerId), patch, 'after'); },
    undo(model) { applyBrushPatch(model.getLayer(layerId), patch, 'before'); }
  });
}

export function createLayerEnabledCommand(collection, layerId, enabled) {
  assertUint32(layerId, 'layerId');
  if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean.');
  const before = collection.getLayer(layerId).enabled;
  return Object.freeze({
    kind: 'field-layer-enabled',
    layerId,
    before,
    after: enabled,
    redo(model) { model.setEnabled(layerId, enabled); },
    undo(model) { model.setEnabled(layerId, before); }
  });
}

export function createLayerMoveCommand(collection, layerId, toIndex) {
  assertUint32(layerId, 'layerId');
  const before = [...collection.order];
  const probe = [...before];
  const fromIndex = probe.indexOf(layerId);
  if (fromIndex < 0) throw new RangeError(`Unknown field layer ID ${layerId}.`);
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= probe.length) throw new RangeError('toIndex is out of range.');
  probe.splice(fromIndex, 1);
  probe.splice(toIndex, 0, layerId);
  const after = Object.freeze(probe);
  return Object.freeze({
    kind: 'field-layer-move',
    layerId,
    before: Object.freeze(before),
    after,
    redo(model) { model.setOrder(after); },
    undo(model) { model.setOrder(before); }
  });
}
