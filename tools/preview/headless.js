// Ahamkara Wishes — tiny headless-Chrome driver (dev tool, zero dependencies).
//
// Drives a separate headless Chrome over the DevTools Protocol, using Node's
// built-in WebSocket (Node 22+). It never touches your normal Chrome profile:
// it runs with its own profile under tools/preview/.chrome-profile (git-ignored),
// which also keeps the downloaded Bungie game data between runs.
//
//   const { launch } = require('./headless');
//   const browser = await launch();
//   const page = await browser.newPage({ width: 360, height: 720 });
//   await page.goto('http://127.0.0.1:8765/sidepanel.html?fixture=demo');
//   const n = await page.eval(() => document.querySelectorAll('.wc-card').length);
//   await page.screenshot('out.png');
//   await browser.close();
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);

function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH to your Chrome or Chromium binary.');
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForFile(file, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { const t = fs.readFileSync(file, 'utf8'); if (t.includes('\n')) return t; } catch (e) { /* not yet */ }
    await sleep(50);
  }
  throw new Error('Chrome did not start (no DevToolsActivePort)');
}

/** One CDP connection (to a page target). */
class Session {
  constructor(ws) {
    this.ws = ws; this.nextId = 1; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      } else if (msg.method) {
        (this.handlers.get(msg.method) || []).forEach((h) => h(msg.params));
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  on(method, fn) { if (!this.handlers.has(method)) this.handlers.set(method, []); this.handlers.get(method).push(fn); }
  once(method, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timed out waiting for ' + method)), timeoutMs);
      const fn = (p) => { clearTimeout(t); this.handlers.set(method, (this.handlers.get(method) || []).filter((h) => h !== fn)); resolve(p); };
      this.on(method, fn);
    });
  }
}

class Page {
  constructor(session, target) { this.s = session; this.target = target; this.console = []; this.errors = []; }
  async init(width, height) {
    await this.s.send('Page.enable'); await this.s.send('Runtime.enable');
    this.s.on('Runtime.consoleAPICalled', (p) => this.console.push({ type: p.type, text: p.args.map((a) => (a.value !== undefined ? String(a.value) : a.description || '')).join(' ') }));
    this.s.on('Runtime.exceptionThrown', (p) => this.errors.push((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text));
    await this.setViewport(width, height);
  }
  async setViewport(width, height) {
    await this.s.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  }
  async goto(url, { timeoutMs = 60000 } = {}) {
    const loaded = this.s.once('Page.loadEventFired', timeoutMs);
    await this.s.send('Page.navigate', { url });
    await loaded;
  }
  /** Runs `fn` (a function or expression string) in the page; awaits promises; returns plain data. */
  async eval(fn, ...args) {
    const expression = typeof fn === 'function' ? `(${fn.toString()})(...${JSON.stringify(args)})` : fn;
    const r = await this.s.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('Page error: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  }
  /** Polls `fn` in the page until it returns truthy. */
  async waitFor(fn, { timeoutMs = 30000, intervalMs = 100 } = {}) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const v = await this.eval(fn);
      if (v) return v;
      if (Date.now() > end) throw new Error('waitFor timed out: ' + (typeof fn === 'function' ? fn.toString().slice(0, 120) : fn));
      await sleep(intervalMs);
    }
  }
  async screenshot(file, { fullPage = false } = {}) {
    const params = { format: 'png', captureBeyondViewport: fullPage };
    const r = await this.s.send('Page.captureScreenshot', params);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
}

async function launch({ profileDir, headless = true } = {}) {
  const chrome = findChrome();
  const dir = profileDir || path.join(__dirname, '.chrome-profile');
  fs.mkdirSync(dir, { recursive: true });
  const portFile = path.join(dir, 'DevToolsActivePort');
  try { fs.unlinkSync(portFile); } catch (e) { /* none */ }
  const proc = spawn(chrome, [
    headless ? '--headless=new' : '', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    // Mock keychain: a fresh profile on macOS can otherwise stall on Keychain access.
    '--use-mock-keychain', '--password-store=basic',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--mute-audio', 'about:blank'
  ].filter(Boolean), { stdio: 'ignore' });
  let port;
  try {
    port = (await waitForFile(portFile, 60000)).split('\n')[0].trim();
  } catch (e) {
    // Don't leave a half-started Chrome holding the profile lock.
    proc.kill('SIGKILL');
    throw e;
  }
  const base = `http://127.0.0.1:${port}`;

  return {
    async newPage({ width = 360, height = 720 } = {}) {
      const target = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
      const page = new Page(new Session(ws), target);
      await page.init(width, height);
      return page;
    },
    async close() {
      proc.kill('SIGTERM');
      await sleep(300);
      if (proc.exitCode === null) proc.kill('SIGKILL');
    }
  };
}

module.exports = { launch, sleep };
