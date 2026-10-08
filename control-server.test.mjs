import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { startControlServer } from './control-server.mjs';

// Authored non-Scripture display models; the loader stands in for the SDK.
const display = id => ({ version: { abbreviation: 'FIX' }, html: `<p>Synthetic ${id}</p>`,
  attribution: { text: 'Synthetic credit' }, stylesheets: [], containerAttributes: {} });

async function setup(options = {}) {
  const calls = [];
  let clock = 0;
  const server = await startControlServer({ now: () => clock, ...options,
    load: options.load || (async selection => { calls.push(selection); return display(selection.passageId); }) });
  const post = (path, body, headers = {}) => fetch(server.base + path.slice(1), { method: 'POST',
    headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { server, calls, post, tick: ms => { clock += ms; } };
}

test('show puts a parsed reference on air; display.json follows it; hide clears it', async () => {
  const { server, calls, post } = await setup();
  try {
    assert.equal((await fetch(server.base + 'display.json')).status, 404);
    const shown = await (await post('/api/show', { reference: 'Psalm 23:1', versionId: 3034 })).json();
    assert.deepEqual(calls, [{ versionId: 3034, passageId: 'PSA.23.1' }]);
    assert.deepEqual(shown.onAir, { reference: 'Psalm 23:1', versionId: 3034, passageId: 'PSA.23.1', abbreviation: 'FIX' });
    assert.equal((await (await fetch(server.base + 'display.json')).json()).html, '<p>Synthetic PSA.23.1</p>');
    assert.equal(shown.recent[0].reference, 'Psalm 23:1');
    const hidden = await (await post('/api/hide', {})).json();
    assert.equal(hidden.onAir, null);
    assert.equal((await fetch(server.base + 'display.json')).status, 404);
  } finally { server.close(); }
});

test('a failed or unrecognised request leaves the current passage on air', async () => {
  let fail = false;
  const { server, post, tick } = await setup({ load: async selection => {
    if (fail) throw new Error('https://api.example/secret?app_key=leak');
    return display(selection.passageId);
  } });
  try {
    await post('/api/show', { reference: 'John 3:16', versionId: 3034 });
    tick(2000);
    fail = true;
    const failed = await post('/api/show', { reference: 'Psalm 23', versionId: 3034 });
    assert.equal(failed.status, 502);
    const body = await failed.json();
    assert.doesNotMatch(body.error, /secret|app_key/);
    assert.equal(body.onAir.passageId, 'JHN.3.16');
    const unknown = await post('/api/show', { reference: 'Hezekiah 1:1', versionId: 3034 });
    assert.equal(unknown.status, 400);
    assert.equal((await unknown.json()).onAir.passageId, 'JHN.3.16');
  } finally { server.close(); }
});

test('Platform loads are rate-capped no matter how fast the operator clicks', async () => {
  const { server, calls, post, tick } = await setup({ maxPerHour: 2 });
  try {
    assert.equal((await post('/api/show', { reference: 'John 1:1', versionId: 1 })).status, 200);
    assert.equal((await post('/api/show', { reference: 'John 1:2', versionId: 1 })).status, 429);
    tick(1500);
    assert.equal((await post('/api/show', { reference: 'John 1:3', versionId: 1 })).status, 200);
    tick(1500);
    assert.equal((await post('/api/show', { reference: 'John 1:4', versionId: 1 })).status, 429);
    tick(3600000);
    assert.equal((await post('/api/show', { reference: 'John 1:5', versionId: 1 })).status, 200);
    assert.equal(calls.length, 3);
  } finally { server.close(); }
});

test('cross-site, non-JSON and wrong-host requests are refused', async () => {
  const { server, calls, post } = await setup();
  try {
    assert.equal((await post('/api/show', { reference: 'John 1:1', versionId: 1 }, { origin: 'https://evil.example' })).status, 403);
    const form = await fetch(server.base + 'api/show', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"reference":"John 1:1","versionId":1}' });
    assert.equal(form.status, 415);
    const port = new URL(server.base).port;
    const status = await new Promise((resolve, reject) => {
      httpRequest({ host: '127.0.0.1', port, path: '/api/state', headers: { host: `rebind.example:${port}` } },
        response => { response.resume(); resolve(response.statusCode); }).on('error', reject).end();
    });
    assert.equal(status, 421);
    assert.equal(calls.length, 0);
    assert.equal((await fetch(server.base + 'sdk-check/package.json')).status, 404);
  } finally { server.close(); }
});

test('overlays get change events and report whether the passage fitted', async () => {
  const { server, post } = await setup();
  try {
    const response = await fetch(server.base + 'events?role=output');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const next = async () => {
      while (!/\n\n/.test(buffer)) buffer += decoder.decode((await reader.read()).value);
      const [event, ...rest] = buffer.split('\n\n');
      buffer = rest.join('\n\n');
      return { type: /event: (\w+)/.exec(event)[1], data: JSON.parse(/data: (.*)/.exec(event)[1]) };
    };
    assert.equal((await next()).type, 'change');
    assert.equal((await next()).data.overlays, 1);
    await post('/api/show', { reference: 'John 3:16', versionId: 3034 });
    const change = await next();
    assert.equal(change.type, 'change');
    assert.equal(change.data.onAir.passageId, 'JHN.3.16');
    // Stale and unknown reports are ignored; a current one is recorded.
    await post('/api/output', { generation: change.data.generation - 1, state: 'visible' });
    await post('/api/output', { generation: change.data.generation, state: 'bogus' });
    assert.equal((await (await fetch(server.base + 'api/state')).json()).output, null);
    await post('/api/output', { generation: change.data.generation, state: 'refused' });
    assert.equal((await next()).data.output, 'refused');
    await reader.cancel();
  } finally { server.close(); }
});
