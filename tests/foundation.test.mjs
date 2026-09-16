import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createFoundationSnapshot, SUBSYSTEM_STATUS } from '../src/core/index.js';
import { APP_VERSION, FOUNDATION_ISSUE } from '../src/version.js';

test('foundation snapshot reports only implemented foundation capability as ready', () => {
  const snapshot = createFoundationSnapshot();

  assert.equal(snapshot.product, 'FIELDWEAVER');
  assert.equal(snapshot.version, APP_VERSION);
  assert.equal(snapshot.phase, FOUNDATION_ISSUE);
  assert.equal(snapshot.externalNetworkRequired, false);
  assert.equal(snapshot.canonicalMode, 'not-yet-implemented');
  assert.equal(snapshot.subsystemStatus, SUBSYSTEM_STATUS);
  assert.equal(snapshot.subsystemStatus.filter((item) => item.state === 'ready').length, 1);
  assert.equal(snapshot.subsystemStatus.find((item) => item.id === 'simulation')?.state, 'planned');
  assert(Object.isFrozen(snapshot));
});

test('browser version is kept in lockstep with package metadata', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.version, APP_VERSION);
});
