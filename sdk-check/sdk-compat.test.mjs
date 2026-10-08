// Real pinned SDK, stubbed fetch, synthetic key and authored non-Scripture fixtures.
// Proves our adapter accepts the SDK's actual display model; proves no access or rights.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, BibleClient } from '@youversion/platform-core';
import { createPlatformLoader } from '../platform-adapter.mjs';

const KEY = 'synthetic-not-a-key';
const selections = { sample: { versionId: 111, passageId: 'JHN.1.1' } };
const version = {
  id: 111, abbreviation: 'FIX', localized_abbreviation: 'FIX', title: 'Synthetic fixture version',
  localized_title: 'Synthetic fixture version', language_tag: 'en', books: ['JHN'],
  copyright: 'Synthetic fixture credit — no publisher represented.',
  youversion_deep_link: 'https://example.invalid/fixture',
};
const passage = { id: 'JHN.1.1', reference: 'Fixture 1:1', content: '<div><p>Synthetic layout text, not Scripture.</p></div>' };
const realFetch = globalThis.fetch;
let requests;
function stub(routes) {
  requests = [];
  globalThis.fetch = async url => {
    const { pathname, searchParams } = new URL(url);
    requests.push({ pathname, params: Object.fromEntries(searchParams) });
    const body = routes[pathname];
    return body === undefined
      ? new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
const routes = (overrides = {}) => ({
  '/v1/bibles/111/passages/JHN.1.1': passage, '/v1/bibles/111': version, ...overrides,
});
const loader = () => createPlatformLoader(new BibleClient(new ApiClient({ appKey: KEY })), selections);
afterEach(() => { globalThis.fetch = realFetch; });

test('pinned SDK display model passes the adapter unchanged', async () => {
  stub(routes());
  const display = await loader()('sample');
  assert.match(display.html, /Synthetic layout text, not Scripture\./);
  assert.equal(display.attribution.text, version.copyright);
  assert.deepEqual({ ...display.containerAttributes }, { 'data-yv-sdk': '', 'data-slot': 'yv-bible-renderer' });
  assert.deepEqual(display.stylesheets.map(sheet => [sheet.kind, new URL(sheet.href).origin]),
    [['bible', 'https://cdn.youversion.com'], ['font', 'https://api.youversion.com']]);
  // Documented hazard: the font stylesheet URL carries the App Key.
  assert.equal(new URL(display.stylesheets[1].href).searchParams.get('app_key'), KEY);
  const passageRequest = requests.find(request => request.pathname.includes('/passages/'));
  assert.equal(passageRequest.params.include_headings, 'true');
  assert.equal(passageRequest.params.include_notes, 'true');
});

test('SDK attribution fallback and missing attribution fail closed through the adapter', async () => {
  stub(routes({ '/v1/bibles/111': { ...version, copyright: null, promotional_content: 'Synthetic promo credit.' } }));
  assert.equal((await loader()('sample')).attribution.text, 'Synthetic promo credit.');
  stub(routes({ '/v1/bibles/111': { ...version, copyright: ' ', promotional_content: null } }));
  await assert.rejects(loader()('sample'), /^Error: Platform display unavailable$/);
});

test('SDK HTTP errors never leak URLs or keys through the adapter', async () => {
  stub({});
  const error = await loader()('sample').then(() => null, value => value);
  assert.equal(error.message, 'Platform display unavailable');
  assert.doesNotMatch(String(error.stack), new RegExp(KEY));
});
