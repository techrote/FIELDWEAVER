import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../src/version.js';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourceRoots = ['src', 'scripts', 'tests'];
const checkedExtensions = new Set(['.js', '.mjs']);
const failures = [];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolute));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }

  return files;
}

for (const rootName of sourceRoots) {
  const files = await collectFiles(join(projectRoot, rootName));

  for (const file of files) {
    if (!checkedExtensions.has(extname(file))) {
      continue;
    }

    const result = spawnSync(process.execPath, ['--check', file], {
      encoding: 'utf8'
    });

    if (result.status !== 0) {
      failures.push(`${relative(projectRoot, file)}\n${result.stderr || result.stdout}`);
    }
  }
}

const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
if (packageJson.version !== APP_VERSION) {
  failures.push(`package.json version ${packageJson.version} does not match browser APP_VERSION ${APP_VERSION}.`);
}

const html = await readFile(join(projectRoot, 'index.html'), 'utf8');
if (!html.includes('type="module"')) {
  failures.push('index.html must bootstrap through a native ES module.');
}
if (!html.includes('Content-Security-Policy')) {
  failures.push('index.html must declare an explicit Content Security Policy.');
}

const externalUrlPattern = /(?:src|href)\s*=\s*["']https?:\/\//i;
if (externalUrlPattern.test(html)) {
  failures.push('index.html contains a required external resource URL; FIELDWEAVER must remain local-first.');
}

if (failures.length > 0) {
  console.error('Static checks failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('Static checks passed: syntax, version contract, module bootstrap, CSP, and local-resource policy.');
}
