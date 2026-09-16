import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('Windows and POSIX launch helpers use the dependency-free local server', async () => {
  const windows = await readFile(new URL('../0Play.cmd', import.meta.url), 'utf8');
  const posix = await readFile(new URL('../0Play.sh', import.meta.url), 'utf8');

  assert.match(windows, /node scripts\\serve\.mjs --open/);
  assert.match(windows, /where node/);
  assert.match(posix, /node scripts\/serve\.mjs --open/);
  assert.match(posix, /command -v node/);
});
