import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { CANONICAL_ENGINE_VERSION, createFoundationSnapshot, SUBSYSTEM_STATUS } from '../src/core/index.js';
import { APP_VERSION, SIMULATION_ISSUE } from '../src/version.js';

test('foundation snapshot reports the merged runtime and canonical kernel as ready', () => {
  const snapshot = createFoundationSnapshot();

  assert.equal(snapshot.product, 'FIELDWEAVER');
  assert.equal(snapshot.version, APP_VERSION);
  assert.equal(snapshot.phase, SIMULATION_ISSUE);
  assert.equal(snapshot.externalNetworkRequired, false);
  assert.equal(snapshot.canonicalMode, CANONICAL_ENGINE_VERSION);
  assert.equal(snapshot.subsystemStatus, SUBSYSTEM_STATUS);
  assert.equal(snapshot.subsystemStatus.filter((item) => item.state === 'ready').length, 2);
  assert.equal(snapshot.subsystemStatus.find((item) => item.id === 'simulation')?.state, 'ready');
  assert.equal(snapshot.subsystemStatus.find((item) => item.id === 'fields')?.state, 'planned');
  assert(Object.isFrozen(snapshot));
});

test('browser version is kept in lockstep with package metadata', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.version, APP_VERSION);
});
