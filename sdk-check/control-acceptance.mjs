// Control-mode acceptance: the real SDK behind the control server, live.html#control
// in headless Chrome, and the operator's show/switch/hide as HTTP calls. Needs
// YVP_APP_KEY (never printed). Prints pass/fail and references only, never text.
// Usage: YVP_APP_KEY=… node control-acceptance.mjs
import { ApiClient, BibleClient } from '@youversion/platform-core';
import { createPlatformLoader } from '../platform-adapter.mjs';
import { startControlServer } from '../control-server.mjs';
import { startSession, sleep } from '../chrome-devtools.mjs';

const key = process.env.YVP_APP_KEY;
if (!key) { console.error('Set YVP_APP_KEY for an app you operate.'); process.exit(2); }
setTimeout(() => { console.error('Control acceptance exceeded 2 minutes.'); process.exit(3); }, 120000).unref();
const client = new BibleClient(new ApiClient({ appKey: key }));
let calls = 0;
const load = selection => { calls++; return createPlatformLoader(client, { pick: selection }, { minIntervalMs: 0 })('pick'); };

const results = [];
const check = (name, pass, detail = '') => {
  results.push(Boolean(pass));
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass || !detail ? '' : ` — ${JSON.stringify(detail).replaceAll(key, '<key>')}`}`);
};

const control = await startControlServer({ load });
const session = await startSession();
const post = async (action, body = {}) => {
  await sleep(1100); // the server's minimum interval between Platform loads
  const response = await fetch(`${control.base}api/${action}`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
// Wait until the overlay has reported on the current generation.
async function settled() {
  for (let i = 0; i < 60; i++) {
    const state = await (await fetch(`${control.base}api/state`)).json();
    if (state.output) return state;
    await sleep(250);
  }
  return (await fetch(`${control.base}api/state`)).json();
}
const sameHtml = async () => session.evaluate(`(async () => {
  const expected = await (await fetch('display.json', { cache: 'no-store' })).text();
  const reference = document.createElement('template');
  reference.innerHTML = JSON.parse(expected).html;
  return document.querySelector('#content').innerHTML === reference.innerHTML;
})()`);

try {
  await session.viewport(1920, 1080);
  await session.send('Page.navigate', { url: `${control.base}live.html#control` });
  await sleep(1500);
  let state = await settled();
  check('control page reports the overlay connected', state.overlays === 1, state);
  check('nothing on air at start: overlay reports hidden', state.onAir === null && state.output === 'hidden', state);

  let result = await post('show', { reference: 'John 3:16', versionId: 3034 });
  state = await settled();
  check('show "John 3:16": overlay reports visible', result.status === 200 && state.output === 'visible', state);
  check('rendered HTML is the SDK\'s for the passage on air', await sameHtml());

  result = await post('show', { reference: 'Psalm 23:1', versionId: 3034 });
  state = await settled();
  check('switch to "Psalm 23:1" without reloading: visible', state.onAir?.passageId === 'PSA.23.1' && state.output === 'visible', state);
  check('rendered HTML switched to the new passage', await sameHtml());

  result = await post('show', { reference: 'Psalm 119', versionId: 3034 });
  state = await settled();
  check('a whole long chapter is refused, not cropped', state.output === 'refused' && (await session.probe()).hidden, state);

  result = await post('show', { reference: 'Hezekiah 1:1', versionId: 3034 });
  check('an unknown book is rejected before any Platform call', result.status === 400 && result.body.onAir.passageId === 'PSA.119');

  result = await post('hide');
  state = await settled();
  check('hide clears the overlay', state.onAir === null && state.output === 'hidden' && (await session.probe()).hidden, state);

  check('no page errors or CSP violations', session.problems.length === 0, session.problems);
  check('Platform loads: one per accepted show (3)', calls === 3, { calls });
} finally {
  await session.close();
  control.close();
}
const failed = results.filter(pass => !pass).length;
console.log(`\n${results.length - failed}/${results.length} control checks passed.`);
process.exit(failed ? 1 : 0);
