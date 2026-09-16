import { APP_VERSION, FOUNDATION_ISSUE } from '../version.js';

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
    label: 'Canonical simulation',
    state: 'planned',
    issue: 'FW-002',
    detail: 'Not implemented yet. This shell does not simulate or fake canonical state.'
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
    phase: FOUNDATION_ISSUE,
    runtime: 'browser-es-modules',
    canonicalMode: 'not-yet-implemented',
    externalNetworkRequired: false,
    subsystemStatus: SUBSYSTEM_STATUS,
    ...overrides
  };

  return Object.freeze(snapshot);
}
