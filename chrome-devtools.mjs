// Shared by the acceptance scripts: a loopback-only static server for this folder
// and headless Chrome driven over the DevTools protocol. No dependencies.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = dirname(fileURLToPath(import.meta.url));
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Panel state as the viewer would see it. Elements that render nothing are skipped.
export const PROBE = `(() => {
  const panel = document.querySelector('#panel'); const box = el => el.getBoundingClientRect();
  const inside = (a, b) => a.top >= b.top - .5 && a.left >= b.left - .5 && a.bottom <= b.bottom + .5 && a.right <= b.right + .5;
  const viewport = { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
  const shown = !panel.hidden && !panel.inert && !panel.hasAttribute('aria-hidden') &&
    getComputedStyle(panel).visibility === 'visible' && getComputedStyle(panel).display !== 'none';
  const parts = [...panel.querySelectorAll('*')].filter(el => el.getClientRects().length);
  return { shown, hidden: panel.hidden, status: document.querySelector('#status').textContent,
    contained: shown && inside(box(panel), viewport) && parts.every(el => inside(box(el), box(panel))),
    noOverflow: [panel, ...parts].every(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight),
    text: document.querySelector('#content').textContent, credit: document.querySelector('#attribution').textContent,
    direction: getComputedStyle(document.querySelector('#content')).direction,
    focused: document.activeElement === document.body ? null : document.activeElement?.textContent?.trim() };
})()`;

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };

// Loopback-only static server for this folder. routes: optional in-memory
// responses ({ '/path': { type, body } }), checked first.
export async function startServer({ routes = {}, port = 0 } = {}) {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://x').pathname;
    if (routes[pathname]) {
      response.writeHead(200, { 'content-type': routes[pathname].type, 'cache-control': 'no-store' }).end(routes[pathname].body);
      return;
    }
    const path = normalize(decodeURIComponent(pathname)).replace(/^\/+/, '');
    if (path.includes('..') || !types[extname(path)]) { response.writeHead(404).end(); return; }
    try { response.writeHead(200, { 'content-type': types[extname(path)] }).end(await readFile(join(root, path))); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

export async function startSession({ routes = {} } = {}) {
  const chromePath = process.env.CHROME || [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].find(existsSync);
  if (!chromePath) throw new Error('Chrome not found; set CHROME=<path>.');

  const server = await startServer({ routes });
  const { base } = server;

  const profile = await mkdtemp(join(tmpdir(), 'surface-acceptance-'));
  const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu',
    // CI runners (e.g. Ubuntu 24.04) restrict the user namespaces Chrome's sandbox needs.
    ...(process.env.CI ? ['--no-sandbox'] : []), 'about:blank'],
  { stdio: 'ignore' });
  process.on('exit', () => chrome.kill());
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch {}
  }
  if (!port) throw new Error('Chrome DevTools did not start');
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });

  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  const problems = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    } else if (message.method) {
      if (message.method === 'Runtime.exceptionThrown') problems.push(message.params.exceptionDetails.text);
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') problems.push(message.params.entry.text);
      listeners.forEach(listener => listener(message));
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 10000);
    pending.set(id, {
      resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result.value;
  };
  await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable'].map(method => send(method)));

  return {
    base, send, evaluate, problems,
    probe: () => evaluate(PROBE),
    async viewport(width, height) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await sleep(150);
    },
    async open(hash = '', page = 'index.html') {
      // A fragment-only change is same-document and fires no load event.
      await send('Page.navigate', { url: 'about:blank' });
      await sleep(100);
      const loaded = new Promise(resolve => listeners.push(function once(message) {
        if (message.method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(once), 1); resolve(); }
      }));
      await send('Page.navigate', { url: base + page + hash });
      await Promise.race([loaded, sleep(10000).then(() => { throw new Error(`load timed out: ${page}${hash}`); })]);
      await sleep(150);
    },
    async close() {
      socket.close();
      chrome.kill();
      server.close();
      await sleep(300);
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}
