// Operator control server: holds the passage on air, serves the overlay pages, and
// pushes changes to every connected overlay (Server-Sent Events). Loopback only.
// `load({ versionId, passageId })` must return a validated SDK display model; the
// server never sees the App Key. See sdk-check/serve-live.mjs for the SDK wiring.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const { toPassageId } = createRequire(import.meta.url)('./reference.js');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const OUTPUT_STATES = new Set(['visible', 'refused', 'unavailable', 'hidden']);

export async function startControlServer({ load, port = 0, minIntervalMs = 1000, maxPerHour = 120, now = Date.now }) {
  let generation = 0;
  let onAir = null;        // { reference, versionId, passageId, abbreviation, display }
  let output = null;       // last state an overlay reported for the current generation
  let lastLoad = -Infinity;
  let loads = [];
  const recent = [];
  const clients = new Set();

  const state = () => ({
    generation,
    onAir: onAir && { reference: onAir.reference, versionId: onAir.versionId, passageId: onAir.passageId, abbreviation: onAir.abbreviation },
    output: output?.generation === generation ? output.state : null,
    overlays: [...clients].filter(client => client.role === 'output').length,
    recent,
  });
  const broadcast = event => {
    const data = `event: ${event}\ndata: ${JSON.stringify(state())}\n\n`;
    for (const client of clients) client.response.write(data);
  };

  async function show(reference, versionId) {
    const passageId = toPassageId(reference);
    if (!passageId) throw Object.assign(new Error('Not a reference I recognise. Try "Psalm 23:1" or PSA.23.1.'), { status: 400 });
    if (!Number.isSafeInteger(versionId) || versionId <= 0) throw Object.assign(new Error('Version must be a positive number.'), { status: 400 });
    // Platform calls happen only here; cap them regardless of how often the operator clicks.
    const time = now();
    loads = loads.filter(value => time - value < 3600000);
    if (time - lastLoad < minIntervalMs || loads.length >= maxPerHour) {
      throw Object.assign(new Error('Too many changes in a short time. Wait a moment and try again.'), { status: 429 });
    }
    lastLoad = time;
    loads.push(time);
    let display;
    try { display = await load({ versionId, passageId }); }
    catch { throw Object.assign(new Error('That passage could not be loaded for this version. Nothing changed on screen.'), { status: 502 }); }
    const label = String(reference).trim().slice(0, 80);
    onAir = { reference: label, versionId, passageId, abbreviation: display.version?.abbreviation || '', display };
    generation++;
    output = null;
    const entry = { reference: label, versionId };
    const index = recent.findIndex(item => item.reference === label && item.versionId === versionId);
    if (index >= 0) recent.splice(index, 1);
    recent.unshift(entry);
    recent.length = Math.min(recent.length, 8);
    broadcast('change');
  }
  function hide() {
    onAir = null;
    generation++;
    output = null;
    broadcast('change');
  }

  const server = createServer(async (request, response) => {
    const send = (status, body, type = 'application/json') =>
      response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }).end(type === 'application/json' ? JSON.stringify(body) : body);
    const listening = server.address().port;
    const origins = [`http://127.0.0.1:${listening}`, `http://localhost:${listening}`];
    // DNS-rebinding guard: only answer for our own host names.
    if (!origins.some(origin => origin.endsWith(`//${request.headers.host}`))) return send(421, { error: 'Wrong host' });
    const url = new URL(request.url, origins[0]);

    if (request.method === 'POST') {
      // CSRF guard: browsers send Origin on POST; other sites' pages are refused, and
      // requiring a JSON body forces a CORS preflight this server never approves.
      if (request.headers.origin && !origins.includes(request.headers.origin)) return send(403, { error: 'Cross-origin request refused' });
      if (!/^application\/json\b/.test(request.headers['content-type'] || '')) return send(415, { error: 'Send JSON' });
      let raw = '';
      for await (const chunk of request) { raw += chunk; if (raw.length > 4096) return send(413, { error: 'Too large' }); }
      let body;
      try { body = JSON.parse(raw || '{}'); } catch { return send(400, { error: 'Invalid JSON' }); }
      try {
        if (url.pathname === '/api/show') await show(body.reference, Number(body.versionId));
        else if (url.pathname === '/api/hide') hide();
        else if (url.pathname === '/api/output') {
          if (body.generation === generation && OUTPUT_STATES.has(body.state)) {
            output = { generation, state: body.state };
            broadcast('state');
          }
        } else return send(404, { error: 'Not found' });
        return send(200, state());
      } catch (error) {
        return send(error.status || 500, { error: error.status ? error.message : 'Unexpected error', ...state() });
      }
    }
    if (request.method !== 'GET') return send(405, { error: 'Method not allowed' });
    if (url.pathname === '/api/state') return send(200, state());
    if (url.pathname === '/display.json') return onAir ? send(200, onAir.display) : send(404, { error: 'Nothing on air' });
    if (url.pathname === '/events') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      const client = { response, role: url.searchParams.get('role') === 'output' ? 'output' : 'control' };
      clients.add(client);
      response.write(`retry: 2000\nevent: change\ndata: ${JSON.stringify(state())}\n\n`);
      if (client.role === 'output') broadcast('state');
      request.on('close', () => { clients.delete(client); if (client.role === 'output') broadcast('state'); });
      return;
    }
    const path = normalize(decodeURIComponent(url.pathname === '/' ? '/control.html' : url.pathname)).replace(/^\/+/, '');
    if (path.includes('..') || !types[extname(path)] || path.startsWith('sdk-check/')) return send(404, 'Not found', 'text/plain');
    try { send(200, await readFile(join(root, path)), types[extname(path)]); }
    catch { send(404, 'Not found', 'text/plain'); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  return {
    base, show, hide, state,
    close() { for (const client of clients) client.response.end(); server.close(); },
  };
}
