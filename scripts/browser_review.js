'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createBackendService } = require('../src/backend/service');

const root = path.resolve(__dirname, '..');
const maxBodyBytes = 2 * 1024 * 1024; // Config limit plus validated environment paths.
const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

async function readJson(request) {
  if (request.headers['content-type'] !== 'application/json') throw new Error('Expected application/json');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function startBrowserReview(options = {}) {
  if (options.development !== true || process.env.NODE_ENV === 'production' || __dirname.includes('.asar')) {
    throw new Error('Browser Review Bridge is available only in development.');
  }
  const token = crypto.randomBytes(32).toString('hex');
  const userData = path.join(root, 'scratch', 'browser-review', 'userData');
  fs.mkdirSync(userData, { recursive: true });
  let origin;
  let sequence = 0;
  const logs = [];
  const prompts = new Map();
  const prompt = (kind, definition) => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    prompts.set(id, { id, kind, definition, resolve, reject });
  });
  const openPath = (target) => new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve('Browser Review shell actions require Windows.');
    const child = spawn('explorer.exe', [target], { shell: false, windowsHide: true, stdio: 'ignore' });
    child.once('error', (error) => resolve(error.message));
    child.once('spawn', () => { child.unref(); resolve(''); });
  });
  const backend = createBackendService({
    mode: 'browser-review',
    getPath: (kind) => ({ userData, documents: path.join(os.homedir(), 'Documents'), home: os.homedir() })[kind],
    dialog: {
      showOpenDialog: (definition) => prompt('open', definition),
      showSaveDialog: (definition) => prompt('save', definition),
      showMessageBox: (definition) => prompt('confirm', definition)
    },
    openPath,
    openExternal: async (url) => { const error = await openPath(url); if (error) throw new Error(error); }
  });
  function send(response, status, value) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (request.headers.host !== new URL(origin).host
          || (request.headers.origin && request.headers.origin !== origin)
          || (request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site']))) {
        return send(response, 403, { error: 'Untrusted Bridge origin or host' });
      }
      const url = new URL(request.url, origin);
      if (url.pathname.startsWith('/api/')) {
        if (request.headers['x-review-token'] !== token || request.headers.origin !== origin) {
          return send(response, 403, { error: 'Bridge authentication required' });
        }
        if (request.method === 'POST' && url.pathname === '/api/call') {
          const { method, args } = await readJson(request);
          const result = await backend.invoke(method, args, (message) => {
            logs.push({ sequence: ++sequence, message });
            if (logs.length > 2048) logs.shift();
          });
          return send(response, 200, { result: result ?? null });
        }
        if (request.method === 'POST' && url.pathname === '/api/events') {
          const { after } = await readJson(request);
          return send(response, 200, { sequence, logs: logs.filter((entry) => entry.sequence > (Number(after) || 0)),
            prompts: [...prompts.values()].map(({ id, kind, definition }) => ({ id, kind, definition })) });
        }
        if (request.method === 'POST' && url.pathname === '/api/dialog') {
          const { id, value, canceled } = await readJson(request);
          const pending = prompts.get(id);
          if (!pending) throw new Error('Dialog has expired');
          if (typeof canceled !== 'boolean' || (!canceled && typeof value !== 'string')) throw new Error('Invalid dialog response');
          if (!canceled && pending.kind === 'open') {
            const stats = fs.statSync(value);
            const directory = pending.definition.properties?.includes('openDirectory');
            if (directory ? !stats.isDirectory() : !stats.isFile()) throw new Error(directory ? '请选择存在的文件夹。' : '请选择存在的文件。');
          }
          prompts.delete(id);
          pending.resolve(pending.kind === 'confirm' ? { response: canceled ? 0 : 1 }
            : pending.kind === 'save' ? { canceled, filePath: canceled ? undefined : value }
              : { canceled, filePaths: canceled ? [] : [value] });
          return send(response, 200, { result: true });
        }
        return send(response, 404, { error: 'Unknown Bridge route' });
      }
      if (request.method !== 'GET') return send(response, 405, { error: 'Method not allowed' });
      if (url.pathname === '/' || url.pathname === '/src/renderer/index.html') {
        const transports = url.searchParams.getAll('transport');
        if (transports.length > 1 || (transports.length === 1 && transports[0] !== 'bridge')) {
          return send(response, 400, { error: '当前审查服务器仅支持 transport=bridge（真实后端）；Mock 尚未实现。', code: 'UNSUPPORTED_TRANSPORT' });
        }
        if (url.pathname === '/' || transports.length === 0) {
          url.pathname = '/src/renderer/index.html';
          url.searchParams.set('transport', 'bridge');
          response.writeHead(302, { Location: `${url.pathname}${url.search}` });
          response.end();
          return;
        }
      }
      const rendererFiles = { '/': 'src/renderer/index.html', '/src/renderer/index.html': 'src/renderer/index.html',
        '/src/renderer/renderer.js': 'src/renderer/renderer.js', '/src/renderer/api.js': 'src/renderer/api.js',
        '/src/renderer/styles.css': 'src/renderer/styles.css', '/__review/client.js': 'scripts/browser_review_client.js',
        '/__review/styles.css': 'scripts/browser_review.css' };
      let relative = rendererFiles[url.pathname];
      if (url.pathname.startsWith('/assets/')) relative = decodeURIComponent(url.pathname.slice(1));
      if (!relative) return send(response, 404, { error: 'Unknown review asset' });
      const file = path.resolve(root, relative);
      if (!file.startsWith(`${root}${path.sep}`) || (relative.startsWith('assets/') && !file.startsWith(`${path.join(root, 'assets')}${path.sep}`))) {
        return send(response, 403, { error: 'Invalid asset path' });
      }
      let body = fs.readFileSync(file);
      if (relative === 'src/renderer/index.html') {
        body = Buffer.from(body.toString('utf8').replace('<head>', `<head><meta name="browser-review-transport" content="bridge"><meta name="browser-review-token" content="${token}"><meta name="browser-review-log-sequence" content="${sequence}"><link rel="stylesheet" href="/__review/styles.css">`)
          .replace('<script src="./api.js">', '<script src="/__review/client.js"></script>\n    <script src="./api.js">'));
      }
      response.writeHead(200, { 'Content-Type': `${contentTypes[path.extname(file)] || 'application/octet-stream'}; charset=utf-8` });
      response.end(body);
    } catch (error) {
      send(response, 400, { error: error.message, code: error.code });
    }
  });
  server.requestTimeout = 0; // Release compilation may outlast HTTP's default timeout.
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, reviewUrl: `${origin}/?transport=bridge`, server, close: async () => {
    for (const pending of prompts.values()) pending.resolve(pending.kind === 'confirm' ? { response: 0 } : { canceled: true, filePaths: [] });
    prompts.clear();
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } };
}

if (require.main === module) {
  const temporaryDirectory = path.join(root, 'scratch', 'browser-review', 'temp');
  fs.mkdirSync(temporaryDirectory, { recursive: true });
  process.env.TEMP = temporaryDirectory;
  process.env.TMP = temporaryDirectory;
  const portArgument = process.argv.indexOf('--port');
  const port = portArgument < 0 ? 4173 : Number(process.argv[portArgument + 1]);
  startBrowserReview({ development: process.argv.includes('--development'), port }).then(({ reviewUrl }) => {
    console.log(`Browser Review Mode (Bridge / real backend): ${reviewUrl}`);
    console.log('Development only; press Ctrl+C to stop.');
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { startBrowserReview };
