// Source-exact, opt-in admission board; never installs candidate art into the accepted gallery.
// Generates one standalone file using the existing FW-012 CPU verifier and gallery renderer.
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCli } from './review-gallery.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ADMISSION_SELECTION = Object.freeze([
  Object.freeze({
    pr: 57, lane: 'ORIGINAL', title: 'Registry of Vacant Rooms',
    head: '384ef7dd2f5d162b439b916e2ba03d6f30922e47',
    provenance: 'gallery/originals/08-registry-of-vacant-rooms/the-vacant-rooms.provenance.json',
    rgba: '56286fc4c1a47bb8'
  }),
  Object.freeze({
    pr: 50, lane: 'MUTATION', title: 'Unwound Metronome — sibling 17',
    head: '25e6de1906e3e5a4ee66345b8210028b47185507',
    provenance: 'gallery/variants/06-unwound-metronome/selected.provenance.json',
    rgba: '80a5a090d57b6d07'
  }),
]);

function git(args) {
  const result = spawnSync('git', ['-C', ROOT, ...args], {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 2 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error('Git command failed (' + args.slice(0, 3).join(' ') + '): ' +
      (result.error?.message || result.stderr || result.stdout || 'exit ' + result.status).trim());
  }
  return result.stdout.trim();
}

export async function buildAdmissionReview(outputFile) {
  const output = resolve(outputFile);
  const tmp = await mkdtemp(join(tmpdir(), 'fieldweaver-admissions-'));
  const worktrees = [];
  try {
    const args = ['--out', join(tmp, 'verified-review.html'),
      '--preset', 'operator-atlas', '--preset', 'timeline-pulse'];
    for (const candidate of ADMISSION_SELECTION) {
      git(['fetch', '--no-tags', '--quiet', 'origin', 'pull/' + candidate.pr + '/head']);
      const fetched = git(['rev-parse', 'FETCH_HEAD']);
      if (fetched !== candidate.head) {
        throw new Error('PR #' + candidate.pr + ' moved: pinned ' + candidate.head +
          ' but remote is ' + fetched + '. Re-review its exact new head before changing the selection.');
      }
      const path = join(tmp, 'pr-' + candidate.pr);
      git(['worktree', 'add', '--detach', '--quiet', path, fetched]);
      worktrees.push(path);
      args.push('--provenance', join(path, candidate.provenance));
    }
    const result = await runCli(args);
    const candidates = result.entries.filter((entry) => !entry.accepted);
    if (candidates.length !== ADMISSION_SELECTION.length) throw new Error('Unexpected candidate count.');
    for (let i = 0; i < candidates.length; i += 1) {
      if (candidates[i].rawRgbaHash !== ADMISSION_SELECTION[i].rgba) {
        throw new Error('PR #' + ADMISSION_SELECTION[i].pr +
          ' decoded CPU image differs from the pinned curator receipt.');
      }
    }
    // Only publish after every CPU replay, versioned provenance field and
    // archived PNG pixel matches. Never overwrite an existing owner review.
    await copyFile(result.output, output, constants.COPYFILE_EXCL);
    return Object.freeze({
      output, accepted: result.entries.filter((entry) => entry.accepted),
      candidates: candidates.map((entry, i) => Object.freeze({
        ...entry, pr: ADMISSION_SELECTION[i].pr, head: ADMISSION_SELECTION[i].head
      }))
    });
  } finally {
    for (const path of worktrees.reverse()) {
      try { git(['worktree', 'remove', '--force', path]); }
      catch (error) { console.error('Cannot clean temporary worktree ' + path + ': ' + error.message); }
    }
    await rm(tmp, { recursive: true, force: true });
  }
}

function outputFromArgs(args) {
  if (args.length === 0) return resolve('FIELDWEAVER-admission-review.html');
  if (args.length === 2 && args[0] === '--out') return resolve(args[1]);
  throw new Error('Usage: node scripts/admission-review.mjs [--out NEW-FILE.html]');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const output = outputFromArgs(process.argv.slice(2));
    buildAdmissionReview(output).then((result) => {
      console.log('Verified OFFLINE accepted/proposed review: ' + result.output);
      for (const entry of result.candidates) {
        console.log('UNMERGED PR #' + entry.pr + ' @ ' + entry.head.slice(0, 12) +
          ' · decoded RGBA8 ' + entry.rawRgbaHash);
      }
      console.log('Open the HTML in Firefox; review the artwork visually before any admission.');
    }).catch((error) => { console.error(error.stack ?? String(error)); process.exitCode = 1; });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
