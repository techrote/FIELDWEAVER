import { APP_VERSION, FOUNDATION_ISSUE, SIMULATION_ISSUE } from '../version.js';
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
    label: 'Field authoring',
    state: 'planned',
    issue: 'FW-003',
    detail: 'Not implemented yet.'
  }),
  Object.freeze({
    id: 'renderer',
    label: 'WebGL2 preview',
    state: 'planned',
    issue: 'FW-006',
    detail: 'Not implemented yet. The workspace is an explicit placeholder.'
  })
]);

export function createFoundationSnapshot(overrides = {}) {
  const snapshot = {
    product: 'FIELDWEAVER',
    version: APP_VERSION,
    phase: SIMULATION_ISSUE,
    runtime: 'browser-es-modules',
    canonicalMode: CANONICAL_ENGINE_VERSION,
    externalNetworkRequired: false,
    subsystemStatus: SUBSYSTEM_STATUS,
    ...overrides
  };

  return Object.freeze(snapshot);
}
