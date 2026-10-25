#!/usr/bin/env node
// Ahamkara Wishes — local preview server (dev tool, zero dependencies).
//
//   npm run preview            -> http://127.0.0.1:8765/sidepanel.html
//   npm run preview -- 9000    -> another port
//
// Serves the repo as-is and injects tools/preview/chrome-stub.js into
// sidepanel.html just before its first <script>, so the real page runs in a
// normal tab with a fake chrome.* API. Nothing is copied, so the preview can't
// drift from what ships. See tools/preview/README.md.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PREVIEW = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 8765);
const HOST = '127.0.0.1'; // never listen beyond this machine

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.csv': 'text/csv; charset=utf-8', '.md': 'text/plain; charset=utf-8'
};

const STUB_TAG = '<script src="/__preview/chrome-stub.js"></script>';

/** Inserts the stub before the page's first script so it exists before any app code runs. */
function injectStub(html) {
  const i = html.search(/<script\b/i);
  if (i < 0) throw new Error('No <script> tag to inject before');
  return html.slice(0, i) + STUB_TAG + '\n  ' + html.slice(i);
}

/** Resolves a URL path inside `base`, refusing anything that escapes it or touches .git. */
function safeJoin(base, urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  if (full.split(path.sep).includes('.git')) return null;
  return full;
}

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    // Always fresh: a cached copy of an edited script makes a test run against old code.
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function handler(req, res) {
  const url = new URL(req.url, `http://${HOST}`);
  let p = url.pathname;
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  if (p === '/') { res.writeHead(302, { Location: '/sidepanel.html' + url.search }); return res.end(); }
  if (p === '/gallery') p = '/__preview/gallery.html';

  const fromPreview = p.startsWith('/__preview/');
  const file = fromPreview ? safeJoin(PREVIEW, p.slice('/__preview/'.length)) : safeJoin(ROOT, p);
  if (!file) return send(res, 403, 'Forbidden');

  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found: ' + p);
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    if (!fromPreview && p === '/sidepanel.html') {
      try { return send(res, 200, injectStub(data.toString('utf8')), type); } catch (e) { return send(res, 500, e.message); }
    }
    send(res, 200, data, type);
  });
}

/** Starts the server; resolves { server, url }. Port 0 picks a free port (used by ui-check.js). */
function start(port = PORT) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(port, HOST, () => resolve({ server, url: `http://${HOST}:${server.address().port}` }));
  });
}

if (require.main === module) {
  start().then(() => {
    console.log(`Ahamkara Wishes preview: http://${HOST}:${PORT}/sidepanel.html`);
    console.log(`  fixtures:  ?fixture=demo | hostile | empty`);
    console.log(`  gallery:   http://${HOST}:${PORT}/gallery`);
  });
}

module.exports = { injectStub, safeJoin, start };
