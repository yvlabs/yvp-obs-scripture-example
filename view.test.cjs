const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDisplayView } = require('./view.js');
const { createController } = require('./controller.js');
// A DOM double exercises lifecycle contracts, NOT real CSS/layout/accessibility.
function element() {
  const attributes = new Map(), classes = new Set();
  return {
    attributes, hidden: true, inert: false, textContent: '', innerHTML: '', children: [],
    clientWidth: 100, clientHeight: 100, scrollWidth: 100, scrollHeight: 100,
    box: { top: 0, left: 0, bottom: 100, right: 100 }, getBoundingClientRect() { return this.box; },
    classList: { add: n => classes.add(n), remove: n => classes.delete(n) },
    setAttribute: (k, v) => attributes.set(k, v), removeAttribute: k => attributes.delete(k),
    replaceChildren() { this.innerHTML = ''; this.children = []; },
    querySelectorAll() { return this.children; },
    remove() { this.removed = true; },
  };
}
function setup() {
  const panel = element(), content = element(), attribution = element(), status = element(), links = [];
  const document = { createElement: element, head: { append: link => links.push(link) }, fonts: { ready: Promise.resolve() },
    defaultView: { innerWidth: 1280, innerHeight: 720 } };
  const view = createDisplayView({ document, panel, content, attribution, status,
    allowStylesheet: sheet => sheet.href.startsWith('https://example.invalid/'), frame: async () => {} });
  return { view, panel, content, attribution, status, links, document };
}
const display = {
  html: '<p>  Synthetic — untouched. </p>', attribution: { text: '  Synthetic credit\nwith every word. ' },
  stylesheets: [{ kind: 'fixture', rel: 'stylesheet', href: 'https://example.invalid/style.css' }],
  containerAttributes: { 'data-slot': 'yv-bible-renderer', 'data-yv-sdk': '', lang: 'ar', dir: 'rtl' },
};
async function until(predicate) {
  for (let i = 0; i < 50 && !predicate(); i++) await new Promise(r => setImmediate(r));
  assert.ok(predicate(), 'expected asynchronous stage reached');
}
test('resources and fonts finish before visible content; exact text and attributes preserved', async () => {
  const h = setup(); let fontsReady;
  h.document.fonts.ready = new Promise(r => { fontsReady = r; });
  const controller = createController({ load: async () => display, view: h.view });
  const pending = controller.show('synthetic');
  await until(() => h.links.length === 1);
  assert.equal(h.panel.inert, true); assert.equal(h.panel.attributes.get('aria-hidden'), 'true');
  assert.equal(h.content.innerHTML, display.html); assert.equal(h.attribution.textContent, display.attribution.text);
  for (const [k, v] of Object.entries(display.containerAttributes)) assert.equal(h.content.attributes.get(k), v);
  h.links[0].onload(); await new Promise(r => setImmediate(r)); assert.equal(h.panel.inert, true);
  fontsReady(); await pending; assert.equal(h.panel.inert, false);
  controller.hide(); assert.equal(h.panel.hidden, true); assert.equal(h.content.innerHTML, '');
  assert.equal(h.content.attributes.size, 0); assert.equal(h.links[0].removed, true);
});
test('stylesheet error clears content and resources, then recovery can show a fresh display', async () => {
  const h = setup(), controller = createController({ load: async () => display, view: h.view });
  const pending = controller.show('synthetic'); await until(() => h.links.length === 1);
  h.links[0].onerror(); await pending;
  assert.equal(h.panel.hidden, true); assert.equal(h.content.innerHTML, ''); assert.equal(h.links[0].removed, true);
  const recovered = controller.show('synthetic'); await until(() => h.links.length === 2);
  h.links[1].onload(); await recovered; assert.equal(h.panel.inert, false);
});
test('hide cancels stylesheet waits and removes handlers without a late reveal', async () => {
  const h = setup(), controller = createController({ load: async () => display, view: h.view });
  const pending = controller.show('synthetic'); await until(() => h.links.length === 1);
  controller.hide(); await pending;
  assert.equal(h.links[0].onload, null); assert.equal(h.links[0].onerror, null);
  assert.equal(h.panel.hidden, true); assert.equal(h.links[0].removed, true);
});
test('unsupported resources/attributes cannot enter the DOM', async () => {
  for (const value of [
    { ...display, stylesheets: [{ ...display.stylesheets[0], href: 'https://unapproved.invalid/style.css' }] },
    { ...display, containerAttributes: { ...display.containerAttributes, onclick: 'bad' } },
  ]) {
    const h = setup(); h.view.clear();
    await assert.rejects(h.view.prepare(value));
    assert.equal(h.content.innerHTML, ''); assert.equal(h.links.length, 0);
  }
});
test('credit, content and nested overflow all prevent reveal', async () => {
  for (const target of ['panel', 'attribution', 'content', 'nested']) {
    const h = setup();
    const controller = createController({ load: async () => display, view: h.view });
    const pending = controller.show('synthetic'); await until(() => h.links.length === 1);
    if (target === 'nested') { const child = element(); child.scrollWidth = 101; h.content.children.push(child); }
    else h[target].scrollHeight = 101;
    h.links[0].onload(); await pending;
    assert.equal(h.panel.hidden, true); assert.equal(h.content.innerHTML, '');
    assert.match(h.status.textContent, /do not fit/);
  }
});
test('a panel extending outside the viewport is refused, not cropped', async () => {
  for (const box of [{ top: 0, left: 0, bottom: 721, right: 100 }, { top: -1, left: 0, bottom: 100, right: 100 },
    { top: 0, left: 0, bottom: 100, right: 1281 }, { top: 0, left: -1, bottom: 100, right: 100 }]) {
    const h = setup(); h.panel.box = box;
    const controller = createController({ load: async () => display, view: h.view });
    const pending = controller.show('synthetic'); await until(() => h.links.length === 1);
    h.links[0].onload(); await pending;
    assert.equal(h.panel.hidden, true); assert.match(h.status.textContent, /do not fit/);
  }
});
test('new selection replaces resources and clears the previous direction', async () => {
  const h = setup(); let value = display;
  const controller = createController({ load: async () => value, view: h.view });
  const first = controller.show('synthetic'); await until(() => h.links.length === 1); h.links[0].onload(); await first;
  value = { ...display, containerAttributes: { 'data-slot': 'yv-bible-renderer', 'data-yv-sdk': '' },
    stylesheets: [{ ...display.stylesheets[0], href: 'https://example.invalid/changed.css' }] };
  const next = controller.show('synthetic'); await until(() => h.links.length === 2);
  assert.equal(h.content.attributes.has('dir'), false); assert.equal(h.links[0].removed, true);
  assert.equal(h.links[1].href, value.stylesheets[0].href); h.links[1].onload(); await next;
  controller.hide();
});
test('adapter-controller-view integration rejects missing credit and recovers without caching', async () => {
  const { createPlatformLoader } = await import('./platform-adapter.mjs');
  const h = setup(); let value = { ...display, attribution: {} }, calls = 0;
  const load = createPlatformLoader({ async getPassageDisplay() { calls++; return value; } },
    { sample: { versionId: 1, passageId: 'JHN.3.16' } }, { minIntervalMs: 0 });
  const controller = createController({ load, view: h.view });
  await controller.show('sample'); assert.equal(h.panel.hidden, true); assert.equal(h.links.length, 0);
  value = display;
  const pending = controller.show('sample'); await until(() => h.links.length === 1);
  h.links[0].onload(); await pending; assert.equal(h.panel.inert, false);
  value = { ...display, attribution: { text: '' } };
  await controller.show('sample');
  assert.equal(calls, 3); assert.equal(h.panel.hidden, true); assert.equal(h.links[0].removed, true);
});
test('mounted host rejects resource origin tricks and disposes event subscriptions', async () => {
  const { mountPlatformSurface } = await import('./mount.mjs');
  const subscriptions = new Set();
  const events = { addEventListener(type, fn) { subscriptions.add(fn); }, removeEventListener(type, fn) { subscriptions.delete(fn); } };
  const h = setup(); Object.assign(h.document, events);
  h.document.defaultView = { ...h.document.defaultView, ...events };
  Object.assign(h.document.fonts, events);
  const elements = { panel: h.panel, content: h.content, attribution: h.attribution, status: h.status };
  let calls = 0;
  const surface = mountPlatformSurface({ document: h.document, elements,
    bibleClient: { async getPassageDisplay() { calls++; return { ...display,
      stylesheets: [{ ...display.stylesheets[0], href: 'https://example.invalid.evil.invalid/x' }] }; } },
    selections: { sample: { versionId: 1, passageId: 'JHN.3.16' } },
    allowedStylesheetOrigins: ['https://example.invalid'],
  });
  await surface.show('sample'); assert.equal(h.panel.hidden, true); assert.equal(h.links.length, 0);
  assert.equal(subscriptions.size, 4);
  surface.dispose(); assert.equal(subscriptions.size, 0);
  await surface.show('sample'); assert.equal(calls, 1);
  assert.throws(() => mountPlatformSurface({ allowedStylesheetOrigins: ['https://example.invalid/path'] }), /origins/);
});
test('hung font readiness times out and clears all prepared content/resources', async () => {
  const h = setup(); h.document.fonts.ready = new Promise(() => {});
  const controller = createController({ load: async () => display, view: h.view, timeoutMs: 30 });
  const pending = controller.show('synthetic'); await until(() => h.links.length === 1);
  h.links[0].onload(); await pending;
  assert.equal(h.panel.hidden, true); assert.equal(h.links[0].removed, true);
  assert.equal(h.content.innerHTML, ''); assert.match(h.status.textContent, /unavailable/);
});
test('mounted host successfully renders a complete model and hides on host events', async () => {
  const { mountPlatformSurface } = await import('./mount.mjs');
  const h = setup(), callbacks = new Map();
  const events = { addEventListener(type, fn) { callbacks.set(type, fn); }, removeEventListener(type) { callbacks.delete(type); } };
  Object.assign(h.document, events); Object.assign(h.document.fonts, events);
  h.document.defaultView = { ...h.document.defaultView, ...events, requestAnimationFrame: fn => fn() };
  const surface = mountPlatformSurface({ document: h.document,
    elements: { panel: h.panel, content: h.content, attribution: h.attribution, status: h.status },
    bibleClient: { async getPassageDisplay() { return display; } },
    selections: { sample: { versionId: 1, passageId: 'JHN.3.16' } },
    allowedStylesheetOrigins: ['https://example.invalid'],
  });
  const pending = surface.show('sample'); await until(() => h.links.length === 1);
  h.links[0].onload(); await pending;
  assert.equal(h.panel.inert, false); assert.equal(h.attribution.textContent, display.attribution.text);
  assert.match(h.status.textContent, /Selected passage/);
  callbacks.get('resize')(); assert.equal(h.panel.hidden, true);
  surface.dispose(); assert.equal(callbacks.size, 0);
});
