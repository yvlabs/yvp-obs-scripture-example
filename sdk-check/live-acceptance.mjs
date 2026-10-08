// Live acceptance: one real passage through the pinned SDK, this example's adapter and
// live.html in headless Chrome. Needs YVP_APP_KEY in the environment (never printed
// or written). Prints pass/fail and metadata only, never Scripture text or the key.
// Usage: YVP_APP_KEY=… node live-acceptance.mjs [--screenshots <dir>]
// Screenshots contain Scripture: review locally, then delete; never commit them.
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiClient, BibleClient } from '@youversion/platform-core';
import { createPlatformLoader } from '../platform-adapter.mjs';
import { startSession, root, sleep } from '../chrome-devtools.mjs';

const key = process.env.YVP_APP_KEY;
if (!key) { console.error('Set YVP_APP_KEY for an app you operate.'); process.exit(2); }
setTimeout(() => { console.error('Live acceptance exceeded 2 minutes.'); process.exit(3); }, 120000).unref();
const shotsArg = process.argv.indexOf('--screenshots');
const shots = shotsArg > 0 ? process.argv[shotsArg + 1] : null;

// The one selection live.html declares; the server serves nothing else.
const page = readFileSync(join(root, 'live.html'), 'utf8');
const selection = {
  versionId: Number(/data-version-id="(\d+)"/.exec(page)[1]),
  passageId: /data-passage-id="([A-Z0-9.\-]+)"/.exec(page)[1],
};
const load = createPlatformLoader(new BibleClient(new ApiClient({ appKey: key })), { opening: selection });
let display;
let fetches = 0;

const results = [];
const check = (name, pass, detail = '') => {
  results.push(Boolean(pass));
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass || !detail ? '' : ` — ${JSON.stringify(detail)}`}`);
};
const scrub = value => JSON.parse(JSON.stringify(value).replaceAll(key, '<key>'));

try {
  display = await load('opening');
} catch {
  console.error('Platform display unavailable for the configured selection (no details printed).');
  process.exit(1);
}
fetches++;
console.log(`Fetched version ${display.version.id} (${display.version.abbreviation}), passage ${selection.passageId}; ` +
  `HTML ${display.html.length} chars; attribution from ${display.attribution.source}.`);

// Fetched once; every render below reuses it, so the run makes two API calls in total.
const session = await startSession({ routes: { '/display.json': { type: 'application/json', body: JSON.stringify(display) } } });
const { evaluate, probe, viewport, open, problems, send } = session;
try {
  for (const [width, height, required] of [[1280, 720, true], [1920, 1080, true], [640, 360, false]]) {
    await viewport(width, height);
    await open('#show', 'live.html');
    let state;
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      state = await probe();
      if (state.shown || /unavailable|do not fit/.test(state.status)) break;
    }
    const label = `${width}x${height}`;
    if (required) {
      check(`${label}: live passage and credit fully visible`, state.shown && state.contained && state.noOverflow, scrub({ ...state, text: undefined }));
    } else {
      check(`${label}: live passage complete or refused`, (state.shown && state.contained && state.noOverflow) ||
        (state.hidden && /do not fit/.test(state.status)), scrub({ ...state, text: undefined }));
    }
    if (!state.shown) continue;
    const page = await evaluate(`(async () => {
      const content = document.querySelector('#content');
      const sheets = [...document.querySelectorAll('link[rel=stylesheet]')].filter(link => !link.href.endsWith('/overlay.css'));
      await document.fonts.ready;
      const faces = [...document.fonts].filter(face => face.status === 'loaded').map(face => face.family.replace(/"/g, ''));
      // Browsers re-serialize markup, so compare against the SDK HTML parsed the same way.
      const reference = document.createElement('template');
      reference.innerHTML = ${JSON.stringify(display.html)};
      return { sameHtml: content.innerHTML === reference.innerHTML, credit: document.querySelector('#attribution').textContent,
        attrs: Object.fromEntries([...content.attributes].map(a => [a.name, a.value])),
        sheets: sheets.map(link => ({ origin: new URL(link.href).origin, loaded: Boolean(link.sheet) })),
        faces: [...new Set(faces)], family: getComputedStyle(content.querySelector('.verse, p') || content).fontFamily,
        visibleText: document.body.innerText };
    })()`);
    check(`${label}: HTML is exactly the SDK's`, page.sameHtml);
    check(`${label}: credit is exactly the SDK's`, page.credit === display.attribution.text);
    check(`${label}: SDK container attributes present`, page.attrs['data-slot'] === 'yv-bible-renderer' && 'data-yv-sdk' in page.attrs);
    check(`${label}: both Platform stylesheets loaded`, page.sheets.length === 2 && page.sheets.every(sheet => sheet.loaded), page.sheets);
    check(`${label}: Untitled Serif loaded and used for the text`, page.faces.includes('Untitled Serif') &&
      page.family.startsWith('"Untitled Serif"'), { faces: page.faces, family: page.family });
    check(`${label}: key not in visible text`, !page.visibleText.includes(key));
    if (shots) {
      await mkdir(shots, { recursive: true });
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(shots, `live-${label}.png`), Buffer.from(data, 'base64'));
    }
  }
  check('no page errors or CSP violations', problems.length === 0, scrub(problems));
  check('one SDK display fetch served every render', fetches === 1, { fetches });
} finally {
  await session.close();
}
const failed = results.filter(pass => !pass).length;
console.log(`\n${results.length - failed}/${results.length} live checks passed.`);
process.exit(failed ? 1 : 0);
