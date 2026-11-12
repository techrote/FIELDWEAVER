import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function runMockedPosix(failure = '') {
  const dir = mkdtempSync(join(tmpdir(), 'fw-review-launch-'));
  const bin = join(dir, 'mock-bin');
  mkdirSync(bin);
  copyFileSync(join(root, '0Review.sh'), join(dir, '0Review.sh'));
  writeFileSync(join(dir, 'FIELDWEAVER-admission-review-1.html'), 'untouched old review');
  const executables = {
    npm: ['#!/bin/sh', 'printf "npm %s\\n" "$*" >> "$REVIEW_LOG"', '[ "$REVIEW_FAIL" = npm ] && exit 22', 'exit 0'].join('\n') + '\n',
    git: '#!/bin/sh\nexit 0\n',
    node: ['#!/bin/sh', 'printf "node %s\\n" "$*" >> "$REVIEW_LOG"', '[ "$REVIEW_FAIL" = node ] && exit 23', '[ "$1" = scripts/admission-review.mjs ] || exit 24', '[ "$2" = --out ] || exit 25', 'printf "verified html" > "$3"'].join('\n') + '\n',
    'xdg-open': '#!/bin/sh\nprintf "open %s\\n" "$*" >> "$REVIEW_LOG"\n'
  };
  for (const [name, script] of Object.entries(executables)) {
    const path = join(bin, name);
    writeFileSync(path, script);
    chmodSync(path, 0o755);
  }
  const log = join(dir, 'commands.log');
  const result = spawnSync('sh', ['0Review.sh'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, REVIEW_LOG: log, REVIEW_FAIL: failure }
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8') : '';
  const old = readFileSync(join(dir, 'FIELDWEAVER-admission-review-1.html'), 'utf8');
  const newPath = join(dir, 'FIELDWEAVER-admission-review-2.html');
  const next = existsSync(newPath) ? readFileSync(newPath, 'utf8') : null;
  rmSync(dir, { recursive: true, force: true });
  return { result, calls, old, next };
}

test('one-command POSIX review verifies, uses a new filename and opens only generated HTML', () => {
  const { result, calls, old, next } = runMockedPosix();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(old, 'untouched old review');
  assert.equal(next, 'verified html');
  assert.match(calls, /npm run verify/);
  assert.match(calls, /node scripts\/admission-review\.mjs --out FIELDWEAVER-admission-review-2\.html/);
  assert.match(calls, /open FIELDWEAVER-admission-review-2\.html/);
});

test('a source-pin/replay failure cannot open a stale prior review', () => {
  const { result, calls, old, next } = runMockedPosix('node');
  assert.equal(result.status, 1);
  assert.equal(old, 'untouched old review');
  assert.equal(next, null);
  assert.doesNotMatch(calls, /^open /m);
  assert.match(result.stderr, /No stale artwork review was opened/);
});

test('a verification failure blocks generation and browser opening', () => {
  const { result, calls, old, next } = runMockedPosix('npm');
  assert.equal(result.status, 22);
  assert.equal(old, 'untouched old review');
  assert.equal(next, null);
  assert.doesNotMatch(calls, /^node |^open /m);
});

test('Windows launcher preserves the same guarded integration path', () => {
  const cmd = readFileSync(join(root, '0Review.cmd'), 'utf8');
  assert.match(cmd, /call npm run verify/);
  assert.match(cmd, /node scripts\\admission-review\.mjs --out "%REVIEW%"/);
  assert.match(cmd, /for \/L %%N in \(1,1,999\).*if not exist/);
  assert.match(cmd, /Source-exact review failed\. No stale artwork review was opened/);
  assert.match(cmd, /start "" "%CD%\\%REVIEW%"/);
});
