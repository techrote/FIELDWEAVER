import {
  APP_VERSION,
  FOUNDATION_ISSUE,
  SIMULATION_ISSUE,
  FIELDS_ISSUE,
  AGENTS_ISSUE,
  RENDERER_ISSUE
} from '../version.js';
import { CANONICAL_ENGINE_VERSION } from './kernel.js';

export const SUBSYSTEM_STATUS = Object.freeze([
  Object.freeze({
    id: 'foundation',
    label: 'Runtime foundation',
    state: 'ready',
    issue: FOUNDATION_ISSUE,
    detail: 'Local ES-module application shell and quality gates are active.'
  }),
  Object.freeze({
    id: 'simulation',
    label: 'Canonical simulation kernel',
    state: 'ready',
    issue: SIMULATION_ISSUE,
    detail: 'DOM-free fixed-step integer kernel, seeded PRNG, canonical hashing, and chunk coordinates are active.'
  }),
  Object.freeze({
    id: 'fields',
    label: 'Fields and operators',
    state: 'ready',
    issue: FIELDS_ISSUE,
    detail: 'Sparse deterministic authoring storage and five canonical field operators are active.'
  }),
  Object.freeze({
    id: 'agents',
    label: 'Agents and deposition',
    state: 'ready',
    issue: AGENTS_ISSUE,
    detail: 'Deterministic emitters, four material behaviours, and canonical deposition records are active.'
  }),
  Object.freeze({
    id: 'renderer',
    label: 'WebGL2 preview',
    state: 'ready',
    issue: RENDERER_ISSUE,
    detail: 'Read-only WebGL2 deposition preview with pan/zoom, overlays, bounded accumulation, and diagnostics is active.'
  })
]);

export function createFoundationSnapshot(overrides = {}) {
  const snapshot = {
    product: 'FIELDWEAVER',
    version: APP_VERSION,
    phase: RENDERER_ISSUE,
    runtime: 'browser-es-modules',
    canonicalMode: CANONICAL_ENGINE_VERSION,
    externalNetworkRequired: false,
    subsystemStatus: SUBSYSTEM_STATUS,
    ...overrides
  };

  return Object.freeze(snapshot);
}
