import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const projectFiles = [
  '../index.html',
  '../src/app.js',
  '../src/ui/styles.css',
  '../src/ui/shell.js',
  '../src/renderer/webgl2.js'
];

test('browser entry path has no external HTTP resource dependency', async () => {
  for (const relativePath of projectFiles) {
    const content = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    assert.doesNotMatch(content, /(?:src|href)\s*=\s*["']https?:\/\//i, `${relativePath} contains an external resource URL`);
    assert.doesNotMatch(content, /\bfetch\s*\(\s*["']https?:\/\//i, `${relativePath} contains an external fetch`);
  }
});

test('status model reports implemented canonical substrate and noncanonical WebGL2 preview truthfully', async () => {
  const core = await readFile(new URL('../src/core/foundation.js', import.meta.url), 'utf8');
  assert.match(core, /Canonical simulation kernel/);
  assert.match(core, /Fields and operators/);
  assert.match(core, /Agents and deposition/);
  assert.match(core, /WebGL2 preview/);
  assert.match(core, /Read-only WebGL2 deposition preview/);
  assert.doesNotMatch(core, /state: 'planned'/);
});
