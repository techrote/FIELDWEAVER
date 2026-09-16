import { INT32_MAX, INT32_MIN, Q16_ONE, assertInt32 } from '../core/numeric.js';
import {
  fieldCellToGlobalGrid,
  globalGridToFieldCell
} from './model.js';

export const BRUSH_OPERATIONS = Object.freeze(['set', 'add', 'erase']);
export const BRUSH_SHAPES = Object.freeze(['circle', 'square']);
export const BRUSH_FALLOFFS = Object.freeze(['flat', 'linear-ring']);
export const MAX_BRUSH_RADIUS = 64;
export const MAX_STROKE_GRID_STEPS = 1_000_000;

function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new RangeError(`${label} must be one of: ${allowed.join(', ')}.`);
  return value;
}

function saturateBigIntInt32(value) {
  if (value < BigInt(INT32_MIN)) return INT32_MIN;
  if (value > BigInt(INT32_MAX)) return INT32_MAX;
  return Number(value);
}

function roundRatioHalfAwayFromZero(numerator, denominator) {
  if (denominator <= 0n) throw new RangeError('Canonical brush denominator must be positive.');
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  let quotient = absolute / denominator;
  const remainder = absolute % denominator;
  if (remainder * 2n >= denominator) quotient += 1n;
  return negative ? -quotient : quotient;
}

function weightedSet(before, target, weightQ16) {
  const numerator = BigInt(before) * BigInt(Q16_ONE - weightQ16) + BigInt(target) * BigInt(weightQ16);
  return saturateBigIntInt32(roundRatioHalfAwayFromZero(numerator, BigInt(Q16_ONE)));
}

function weightedAdd(before, amount, weightQ16) {
  const delta = roundRatioHalfAwayFromZero(BigInt(amount) * BigInt(weightQ16), BigInt(Q16_ONE));
  return saturateBigIntInt32(BigInt(before) + delta);
}

function applyChannel(before, target, operation, weightQ16) {
  if (operation === 'set') return weightedSet(before, target, weightQ16);
  if (operation === 'add') return weightedAdd(before, target, weightQ16);
  return weightedSet(before, 0, weightQ16);
}

function integerSqrtFloor(value) {
  let root = 0;
  while ((root + 1) * (root + 1) <= value) root += 1;
  return root;
}

function brushWeight(dx, dy, radius, shape, falloff) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  let distance;
  if (shape === 'square') {
    distance = Math.max(ax, ay);
    if (distance > radius) return 0;
  } else {
    const squared = dx * dx + dy * dy;
    if (squared > radius * radius) return 0;
    distance = integerSqrtFloor(squared);
  }
  if (falloff === 'flat' || radius === 0) return Q16_ONE;
  return Number((BigInt(radius + 1 - distance) * BigInt(Q16_ONE)) / BigInt(radius + 1));
}

function normalizeBrushValue(kind, value) {
  if (kind === 'scalar') return [assertInt32(value, 'brush.value')];
  if (!Array.isArray(value) || value.length !== 2) throw new TypeError('Vector brush value must have exactly two channels.');
  return [assertInt32(value[0], 'brush.value[0]'), assertInt32(value[1], 'brush.value[1]')];
}

export function normalizeBrush(layer, brush = {}) {
  const operation = assertEnum(brush.operation ?? 'set', BRUSH_OPERATIONS, 'brush.operation');
  const shape = assertEnum(brush.shape ?? 'circle', BRUSH_SHAPES, 'brush.shape');
  const falloff = assertEnum(brush.falloff ?? 'flat', BRUSH_FALLOFFS, 'brush.falloff');
  const radius = brush.radius ?? 0;
  if (!Number.isInteger(radius) || radius < 0 || radius > MAX_BRUSH_RADIUS) throw new RangeError(`brush.radius must be an integer in [0, ${MAX_BRUSH_RADIUS}].`);
  const value = normalizeBrushValue(layer.kind, brush.value ?? (layer.kind === 'scalar' ? 1 : [1, 0]));
  return Object.freeze({ operation, shape, falloff, radius, value: Object.freeze(value) });
}

function lineCells(a, b) {
  const cells = [];
  let x0 = a.x;
  let y0 = a.y;
  const x1 = b.x;
  const y1 = b.y;
  let dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let count = 0;

  while (true) {
    cells.push({ x: x0, y: y0 });
    count += 1;
    if (count > MAX_STROKE_GRID_STEPS) throw new RangeError(`Canonical stroke exceeds ${MAX_STROKE_GRID_STEPS} grid centers.`);
    if (x0 === x1 && y0 === y1) break;
    const doubled = 2 * error;
    if (doubled >= dy) { error += dy; x0 += sx; }
    if (doubled <= dx) { error += dx; y0 += sy; }
  }
  return cells;
}

function normalizeStrokePoint(point, layer) {
  if (point && Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y)) return { x: point.x, y: point.y };
  if (point && 'chunkX' in point && 'chunkY' in point && 'cellX' in point && 'cellY' in point) {
    return fieldCellToGlobalGrid(point, layer.cellsPerChunk);
  }
  throw new TypeError('Stroke points must be global {x,y} grid coordinates or chunk/cell addresses.');
}

export function canonicalizeStroke(layer, stroke) {
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length === 0) throw new TypeError('stroke.points must contain at least one point.');
  const points = stroke.points.map((point) => normalizeStrokePoint(point, layer));
  const unique = new Map();
  if (points.length === 1) unique.set(`${points[0].x},${points[0].y}`, points[0]);
  for (let index = 1; index < points.length; index += 1) {
    for (const cell of lineCells(points[index - 1], points[index])) unique.set(`${cell.x},${cell.y}`, cell);
  }
  if (unique.size > MAX_STROKE_GRID_STEPS) throw new RangeError(`Canonical stroke exceeds ${MAX_STROKE_GRID_STEPS} unique grid centers.`);
  return Object.freeze([...unique.values()].sort((left, right) => left.y - right.y || left.x - right.x).map(Object.freeze));
}

function channelsFromPublic(kind, value) {
  return kind === 'scalar' ? [value] : [value[0], value[1]];
}

function publicFromChannels(kind, channels) {
  return kind === 'scalar' ? channels[0] : channels;
}

export function createBrushPatch(layer, stroke, brushDefinition = {}) {
  const brush = normalizeBrush(layer, brushDefinition);
  const centers = canonicalizeStroke(layer, stroke);
  const working = new Map();

  for (const center of centers) {
    for (let dy = -brush.radius; dy <= brush.radius; dy += 1) {
      for (let dx = -brush.radius; dx <= brush.radius; dx += 1) {
        const weight = brushWeight(dx, dy, brush.radius, brush.shape, brush.falloff);
        if (weight === 0) continue;
        const x = center.x + dx;
        const y = center.y + dy;
        const key = `${x},${y}`;
        let state = working.get(key);
        if (!state) {
          const address = globalGridToFieldCell(x, y, layer.cellsPerChunk);
          const before = channelsFromPublic(layer.kind, layer.readCell(address));
          state = { x, y, before, after: [...before] };
          working.set(key, state);
        }
        state.after = state.after.map((entry, channel) => applyChannel(entry, brush.value[channel], brush.operation, weight));
      }
    }
  }

  return Object.freeze([...working.values()]
    .filter((entry) => entry.before.some((value, index) => value !== entry.after[index]))
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .map((entry) => Object.freeze({
      x: entry.x,
      y: entry.y,
      before: Object.freeze([...entry.before]),
      after: Object.freeze([...entry.after])
    })));
}

export function applyBrushPatch(layer, patch, direction = 'after') {
  if (direction !== 'before' && direction !== 'after') throw new RangeError('Patch direction must be before or after.');
  for (const entry of patch) {
    const address = globalGridToFieldCell(entry.x, entry.y, layer.cellsPerChunk);
    layer.writeCell(address, publicFromChannels(layer.kind, entry[direction]));
  }
}
