import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformLoader } from './platform-adapter.mjs';
// Reference identifiers are not Scripture; this fixture proves no licensed access.
const selections = { sample: { versionId: 1, passageId: 'JHN.3.16' } };
const display = { html: '<p>  Synthetic content — untouched. </p>', attribution: { text: ' Synthetic credit ' },
  stylesheets: [{ kind: 'fixture', rel: 'stylesheet', href: 'https://example.invalid/fixture.css' }],
  containerAttributes: { 'data-slot': 'yv-bible-renderer', 'data-yv-sdk': '' } };
test('official SDK display contract and request options are preserved', async () => {
  let options;
  const load = createPlatformLoader({ async getPassageDisplay(value) { options = value; return display; } }, selections);
  assert.equal(await load('sample'), display);
  assert.deepEqual(options, { ...selections.sample, includeHeadings: true, includeNotes: true });
});
test('unconfigured selections cannot reach the SDK', async () => {
  let calls = 0;
  const load = createPlatformLoader({ async getPassageDisplay() { calls++; return display; } }, selections);
  await assert.rejects(load('other'), /not configured/); assert.equal(calls, 0);
});
test('incomplete attribution/resources fail closed', async () => {
  for (const invalid of [{ ...display, attribution: { text: '' } }, { ...display, stylesheets: [] }, { ...display, html: '' }, { ...display, containerAttributes: null }]) {
    const load = createPlatformLoader({ async getPassageDisplay() { return invalid; } }, selections);
    await assert.rejects(load('sample'), /Platform display unavailable/);
  }
});
test('selection configuration is copied and rejects malformed identifiers', async () => {
  const mutable = { sample: { ...selections.sample } };
  let request;
  const load = createPlatformLoader({ async getPassageDisplay(value) { request = value; return display; } }, mutable);
  mutable.sample.versionId = 999; await load('sample'); assert.equal(request.versionId, 1);
  assert.throws(() => createPlatformLoader({ getPassageDisplay() {} }, { bad: { versionId: 0, passageId: 'invalid' } }), /Invalid/);
});
test('invalid metadata shapes, attributes, resources and oversized displays fail closed', async () => {
  for (const invalid of [null, {}, { ...display, containerAttributes: [] },
    { ...display, containerAttributes: { ...display.containerAttributes, onclick: 'invalid' } },
    { ...display, stylesheets: [{ kind: 'fonts', href: 'https://example.invalid/a.css' }] },
    { ...display, html: 'x'.repeat(262145) }]) {
    const load = createPlatformLoader({ async getPassageDisplay() { return invalid; } }, selections);
    await assert.rejects(load('sample'), /Platform display unavailable/);
  }
});
test('nonpositive, unsafe and reversed passage identifiers cannot reach the SDK', () => {
  for (const passageId of ['JHN.0', 'JHN.3.0', 'JHN.3.20-16', 'JHN.999999999999999999', 'JHN.3?x=1']) {
    assert.throws(() => createPlatformLoader({ getPassageDisplay() {} }, { a: { versionId: 1, passageId } }), /Invalid/);
  }
});
test('SDK failures are bounded, not retried, and raw error details are suppressed', async () => {
  let calls = 0, time = 0;
  const load = createPlatformLoader({ async getPassageDisplay() { calls++; throw new Error('private-fixture-url'); } }, selections,
    { now: () => time, minIntervalMs: 1000, maxCalls: 2, windowMs: 10000 });
  await assert.rejects(load('sample'), { message: 'Platform display unavailable' });
  await assert.rejects(load('sample'), /budget/);
  time = 1000; await assert.rejects(load('sample'), /unavailable/);
  time = 5000; await assert.rejects(load('sample'), /budget/);
  assert.equal(calls, 2);
  time = 10000; await assert.rejects(load('sample'), /unavailable/);
  assert.equal(calls, 3);
});
test('cancelled SDK work cannot display or open another in-flight call; settlement recovers', async () => {
  let resolve, calls = 0;
  const load = createPlatformLoader({ getPassageDisplay() { calls++; return new Promise(r => { resolve = r; }); } }, selections,
    { minIntervalMs: 0 });
  const abort = new AbortController();
  const pending = load('sample', { signal: abort.signal });
  abort.abort();
  await assert.rejects(load('sample'), /budget/);
  assert.equal(calls, 1);
  resolve(display); await assert.rejects(pending, /unavailable/);
  const next = load('sample'); resolve(display); assert.equal(await next, display);
  await assert.rejects(load('sample', { signal: abort.signal }), /cancelled/);
  assert.equal(calls, 2);
});
test('metadata failure is never memoized; later success uses a fresh full display', async () => {
  let value = { ...display, attribution: {} };
  const load = createPlatformLoader({ async getPassageDisplay() { return value; } }, selections, { minIntervalMs: 0 });
  await assert.rejects(load('sample'), /unavailable/);
  value = { ...display, attribution: { text: 'New synthetic notice' } };
  assert.equal(await load('sample'), value);
});
