import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  contentTypeFor,
  createStaticServer,
  parseArguments,
  resolveRequestPath
} from '../scripts/serve.mjs';

test('request path resolution stays inside the project root', () => {
  const root = join(tmpdir(), 'fieldweaver-root');

  assert.equal(resolveRequestPath(root, '/'), join(root, 'index.html'));
  assert.equal(resolveRequestPath(root, '/src/app.js?cache=1'), join(root, 'src', 'app.js'));
  assert.equal(resolveRequestPath(root, '/../secret.txt'), null);
  assert.equal(resolveRequestPath(root, '/%2e%2e/%2e%2e/secret.txt'), null);
  assert.equal(resolveRequestPath(root, '/%E0%A4%A'), null);
});

test('content types cover application resources', () => {
  assert.equal(contentTypeFor('index.html'), 'text/html; charset=utf-8');
  assert.equal(contentTypeFor('styles.css'), 'text/css; charset=utf-8');
  assert.equal(contentTypeFor('app.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentTypeFor('unknown.bin'), 'application/octet-stream');
});

test('argument parser supports documented local server flags', () => {
  assert.deepEqual(parseArguments([]), { host: '127.0.0.1', port: 4173, open: false });
  assert.deepEqual(parseArguments(['--port', '0', '--host', '0.0.0.0', '--open']), {
    host: '0.0.0.0',
    port: 0,
    open: true
  });
  assert.throws(() => parseArguments(['--port', '70000']), /--port/);
  assert.throws(() => parseArguments(['--mystery']), /Unknown argument/);
});

function httpRequest(port, path, method = 'GET') {
  return new Promise((resolvePromise, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolvePromise({
          statusCode: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8')
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('static server serves local files, HEAD, security headers, and errors correctly', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'fieldweaver-server-'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>FIELDWEAVER</title>', 'utf8');
  await writeFile(join(root, 'app.js'), 'export const ready = true;\n', 'utf8');

  const server = createStaticServer({ rootDir: root });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  t.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));

  const address = server.address();
  assert(address && typeof address === 'object');
  const port = address.port;

  const page = await httpRequest(port, '/');
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /FIELDWEAVER/);
  assert.match(page.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');

  const head = await httpRequest(port, '/app.js', 'HEAD');
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, '');
  assert.match(head.headers['content-type'], /^text\/javascript/);

  const missing = await httpRequest(port, '/missing.js');
  assert.equal(missing.statusCode, 404);

  const method = await httpRequest(port, '/', 'POST');
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.allow, 'GET, HEAD');
});
