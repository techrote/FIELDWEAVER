import {
  APP_VERSION,
  FOUNDATION_ISSUE,
  SIMULATION_ISSUE,
  FIELDS_ISSUE,
  AGENTS_ISSUE,
  RENDERER_ISSUE,
  EDITOR_ISSUE,
  LUT_ISSUE,
  RECIPE_ISSUE,
  TIMELINE_ISSUE,
  MUTATION_ISSUE,
  EXPORT_ISSUE,
  INFINITE_PLATE_ISSUE,
  RELEASE_ISSUE
} from '../version.js';
import { CANONICAL_ENGINE_VERSION } from './kernel.js';

export const SUBSYSTEM_STATUS = Object.freeze([
  Object.freeze({ id: 'foundation', label: 'Runtime foundation', state: 'ready', issue: FOUNDATION_ISSUE, detail: 'Local ES-module application shell and quality gates are active.' }),
  Object.freeze({ id: 'simulation', label: 'Canonical simulation kernel', state: 'ready', issue: SIMULATION_ISSUE, detail: 'DOM-free fixed-step integer kernel, seeded PRNG, canonical hashing, and chunk coordinates are active.' }),
  Object.freeze({ id: 'fields', label: 'Fields and operators', state: 'ready', issue: FIELDS_ISSUE, detail: 'Sparse deterministic authoring storage, painted vector sources, and five canonical field operators are active.' }),
  Object.freeze({ id: 'agents', label: 'Agents and deposition', state: 'ready', issue: AGENTS_ISSUE, detail: 'Deterministic emitters, four material behaviours, and canonical deposition records are active.' }),
  Object.freeze({ id: 'renderer', label: 'WebGL2 preview', state: 'ready', issue: RENDERER_ISSUE, detail: 'Read-only noncanonical WebGL2 deposition preview with cached artwork geometry, pan/zoom, overlays, bounded accumulation, and diagnostics is active.' }),
  Object.freeze({ id: 'editor', label: 'Instrument editor', state: 'ready', issue: EDITOR_ISSUE, detail: 'Field painting, emitter/material editing, deterministic transport, seed control, and authoring undo/redo are active.' }),
  Object.freeze({ id: 'lut', label: 'LUT logic', state: 'ready', issue: LUT_ISSUE, detail: 'Versioned deterministic LUT assets drive preview colour and validated canonical material parameters.' }),
  Object.freeze({ id: 'recipe', label: 'Recipe persistence', state: 'ready', issue: RECIPE_ISSUE, detail: 'Versioned validated recipes, normalized identities, save/load, and deterministic command replay are active.' }),
  Object.freeze({ id: 'timeline', label: 'Timeline replay', state: 'ready', issue: TIMELINE_ISSUE, detail: 'Linear event editing, forward-only replay, bounded checkpoints, deterministic seeking, and separate timeline undo/redo are active.' }),
  Object.freeze({ id: 'mutation', label: 'Mutation lineage', state: 'ready', issue: MUTATION_ISSUE, detail: 'Deterministic recipe mutation, immutable lineage, sibling generation, exact diffs, and isolated variant comparison are active.' }),
  Object.freeze({ id: 'export', label: 'Canonical image export', state: 'ready', issue: EXPORT_ISSUE, detail: 'Integer software rasterization, raw RGBA identity, dependency-free PNG packaging, tiled evaluation, and provenance sidecars are active.' }),
  Object.freeze({ id: 'infinite-plate', label: 'Infinite Plate', state: 'ready', issue: INFINITE_PLATE_ISSUE, detail: 'Explicit finite domains, deterministic reference replay, sparse chunk memoization, cache-independent hashes, framing, cancellation, and regional canonical export are active.' }),
  Object.freeze({ id: 'release', label: 'Release readiness', state: 'ready', issue: RELEASE_ISSUE, detail: 'Curated deterministic presets, consolidated telemetry, browser/accessibility hardening, bounded-memory documentation, and release workflow coverage are active.' })
]);

export function createFoundationSnapshot(overrides = {}) {
  const snapshot = {
    product: 'FIELDWEAVER',
    version: APP_VERSION,
    phase: RELEASE_ISSUE,
    runtime: 'browser-es-modules',
    canonicalMode: CANONICAL_ENGINE_VERSION,
    externalNetworkRequired: false,
    subsystemStatus: SUBSYSTEM_STATUS,
    ...overrides
  };
  return Object.freeze(snapshot);
}
