const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('./controller.js');
const fixture = { html: '<p>  Synthetic — café\nsecond line </p>', attribution: { text: '  Synthetic credit  ' } };
function harness(load, fits = async () => true) {
  const state = { visible: false, display: null, message: '' };
  const controller = createController({ load, view: {
    clear() { state.visible = false; state.display = null; },
    prepare(display) { state.display = display; }, fits,
    reveal() { state.visible = true; }, status(message) { state.message = message; },
  } });
  return { controller, state };
}
test('content and attribution are handed to the view unchanged', async () => {
  const { controller, state } = harness(async () => fixture);
  await controller.show('demo');
  assert.equal(state.display, fixture);
  assert.equal(state.visible, true);
});
test('missing/blank attribution clears an earlier display', async () => {
  for (const text of [undefined, '', ' \n ']) {
    const { controller, state } = harness(async name => name === 'ok' ? fixture : { ...fixture, attribution: { text } });
    await controller.show('ok'); await controller.show('bad');
    assert.equal(state.display, null); assert.equal(state.visible, false);
  }
});
test('overflow rejects the whole display instead of truncating text or credit', async () => {
  const { controller, state } = harness(async () => fixture, async () => false);
  await controller.show('long');
  assert.equal(state.visible, false); assert.equal(state.display, null);
  assert.match(state.message, /do not fit/);
});
test('provider failures remove stale content and suppress raw diagnostics', async () => {
  const { controller, state } = harness(async name => {
    if (name === 'bad') throw new Error('synthetic-private-diagnostic');
    return fixture;
  });
  await controller.show('ok'); await controller.show('bad');
  assert.equal(state.visible, false); assert.equal(state.display, null);
  assert.doesNotMatch(state.message, /synthetic-private/);
});
test('hide invalidates an in-flight load', async () => {
  let resolve;
  const { controller, state } = harness(() => new Promise(r => { resolve = r; }));
  const pending = controller.show('demo'); controller.hide(); resolve(fixture); await pending;
  assert.equal(state.visible, false); assert.equal(state.display, null);
});
test('late earlier request cannot replace a newer selection', async () => {
  let resolve;
  const newer = { ...fixture, html: '<p>New synthetic fixture</p>' };
  const { controller, state } = harness(name => name === 'old' ? new Promise(r => { resolve = r; }) : newer);
  const old = controller.show('old'); await controller.show('new'); resolve(fixture); await old;
  assert.equal(state.display, newer); assert.equal(state.visible, true);
});
test('hide during layout measurement prevents a late reveal', async () => {
  let resolve;
  const { controller, state } = harness(async () => fixture, () => new Promise(r => { resolve = r; }));
  const pending = controller.show('demo');
  while (!resolve) await new Promise(r => setImmediate(r));
  controller.hide(); resolve(true); await pending;
  assert.equal(state.visible, false); assert.equal(state.display, null);
});
test('whole-operation deadline clears a loader that never settles', async () => {
  const state = { visible: true };
  const controller = createController({ timeoutMs: 10, load: () => new Promise(() => {}), view: {
    clear() { state.visible = false; }, status(value) { state.status = value; },
  } });
  await controller.show('demo');
  assert.equal(state.visible, false); assert.match(state.status, /unavailable/);
});
test('deadline also covers async stylesheet preparation', async () => {
  let signal, cleared = 0, revealed = false;
  const controller = createController({ timeoutMs: 10, load: async () => fixture, view: {
    clear() { cleared++; }, status() {}, prepare(_, options) { signal = options.signal; return new Promise(() => {}); },
    reveal() { revealed = true; },
  } });
  await controller.show('demo');
  assert.equal(signal.aborted, true); assert.equal(cleared, 2); assert.equal(revealed, false);
});
test('late rejection from a superseded loader cannot clear the new display', async () => {
  let reject;
  const { controller, state } = harness(name => name === 'old' ? new Promise((_, r) => { reject = r; }) : fixture);
  const old = controller.show('old'); await controller.show('new');
  reject(new Error('late private detail')); await old;
  assert.equal(state.visible, true); assert.equal(state.display, fixture);
});
