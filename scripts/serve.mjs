import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4173;

const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp'
});

export function contentTypeFor(filePath) {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function resolveRequestPath(rootDir, requestUrl) {
  let pathname;

  try {
    const rawPath = String(requestUrl).split(/[?#]/, 1)[0].replace(/\\/g, '/');
    pathname = decodeURIComponent(rawPath);
    if (pathname.split('/').includes('..')) {
      return null;
    }
  } catch {
    return null;
  }

  if (pathname === '/') {
    pathname = '/index.html';
  }

  const relative = normalize(pathname.replace(/^[/\\]+/, ''));

  if (relative === '..' || relative.startsWith(`..${sep}`) || isAbsolute(relative)) {
    return null;
  }

  const root = resolve(rootDir);
  const candidate = resolve(root, relative);

  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    return null;
  }

  return candidate;
}

function applySecurityHeaders(response) {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
}

async function serveFile(rootDir, request, response) {
  applySecurityHeaders(response);

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method Not Allowed');
    return;
  }

  const filePath = resolveRequestPath(rootDir, request.url ?? '/');

  if (!filePath) {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Bad Request');
    return;
  }

  let fileStat;

  try {
    fileStat = await stat(filePath);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
    return;
  }

  if (!fileStat.isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
    return;
  }

  response.writeHead(200, {
    'Content-Type': contentTypeFor(filePath),
    'Content-Length': fileStat.size,
    'Cache-Control': 'no-cache'
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  const stream = createReadStream(filePath);
  stream.on('error', () => {
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    response.end('Internal Server Error');
  });
  stream.pipe(response);
}

export function createStaticServer({ rootDir }) {
  if (!rootDir) {
    throw new TypeError('createStaticServer requires rootDir.');
  }

  return createServer((request, response) => {
    void serveFile(rootDir, request, response);
  });
}

export function parseArguments(argv) {
  const options = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    open: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--open') {
      options.open = true;
    } else if (argument === '--host') {
      options.host = argv[index + 1] ?? options.host;
      index += 1;
    } else if (argument === '--port') {
      const candidate = Number.parseInt(argv[index + 1] ?? '', 10);
      if (!Number.isInteger(candidate) || candidate < 0 || candidate > 65535) {
        throw new RangeError('--port must be an integer from 0 to 65535.');
      }
      options.port = candidate;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function openBrowser(url) {
  const commands = process.platform === 'win32'
    ? [['cmd', ['/c', 'start', '', url]]]
    : process.platform === 'darwin'
      ? [['open', [url]]]
      : [['xdg-open', [url]]];

  const [command, args] = commands[0];
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore'
  });

  child.on('error', (error) => {
    console.warn(`Could not open a browser automatically: ${error.message}`);
  });
  child.unref();
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const scriptDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
  const rootDir = resolve(scriptDir, '..');
  const server = createStaticServer({ rootDir });

  server.on('error', (error) => {
    console.error(`FIELDWEAVER server failed: ${error.message}`);
    process.exitCode = 1;
  });

  server.listen(options.port, options.host, () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : options.port;
    const hostForUrl = options.host === '0.0.0.0' ? '127.0.0.1' : options.host;
    const url = `http://${hostForUrl}:${port}/`;

    console.log(`FIELDWEAVER local server: ${url}`);
    console.log('Press Ctrl+C to stop.');

    if (options.open) {
      openBrowser(url);
    }
  });

  const stop = () => {
    server.close(() => process.exit(0));
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

const executedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (executedPath === import.meta.url) {
  await main();
}
