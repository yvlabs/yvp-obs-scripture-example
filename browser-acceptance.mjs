// Real-browser acceptance for the synthetic demo: headless Chrome over the DevTools
// protocol, a loopback-only static server, no dependencies and no network content.
// Usage: node browser-acceptance.mjs [--screenshots <dir>]   (CHROME=<path> to override)
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { startSession, sleep } from './chrome-devtools.mjs';

setTimeout(() => { console.error('Acceptance run exceeded 3 minutes.'); process.exit(3); }, 180000).unref();
const shotsArg = process.argv.indexOf('--screenshots');
const shots = shotsArg > 0 ? process.argv[shotsArg + 1] : null;
const session = await startSession();
const { send, evaluate, problems, probe, viewport, open } = session;
const press = async (key, code = key, keyCode, text) => {
  await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, text });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
};
const choose = name => evaluate(`document.querySelector('[data-case=${name}]').click()`);
async function screenshot(name) {
  if (!shots) return;
  await mkdir(shots, { recursive: true });
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(shots, `${name}.png`), Buffer.from(data, 'base64'));
}

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass || !detail ? '' : ` — ${JSON.stringify(detail)}`}`);
};
const FIXTURE = 'This is a synthetic layout sample.';
const FIT = /do not fit/;

try {
  // Invariant everywhere: if the panel is visible it is complete and entirely on screen.
  // Required: at OBS canvas sizes the short demo shows; smaller sizes may refuse.
  const safe = state => (state.shown && state.contained && state.noOverflow) || (state.hidden && FIT.test(state.status));
  const sizes = [[1280, 720, '1280x720', true], [1920, 1080, '1920x1080', true],
    [640, 360, '640x360 (200% zoom of 1280x720)', false], [375, 667, '375x667 narrow', false]];
  for (const page of ['index.html', 'output.html']) for (const [width, height, label, required] of sizes) {
    const name = `${page} ${label}`;
    await viewport(width, height);
    await open('', page);
    await press('1', 'Digit1', 49, '1'); await sleep(700);
    let state = await probe();
    check(`${name}: demo ${required ? 'fully visible' : 'complete or refused'}`, required
      ? state.shown && state.contained && state.noOverflow && state.text.startsWith(FIXTURE) && state.credit.startsWith('Synthetic fixture')
      : safe(state), state);
    await screenshot(`${page.replace('.html', '')}-${width}x${height}-short`);
    await press('2', 'Digit2', 50, '2'); await sleep(700);
    state = await probe();
    check(`${name}: overflow refuses display`, !state.shown && state.hidden && FIT.test(state.status), state);
    await press('7', 'Digit7', 55, '7'); await sleep(700);
    check(`${name}: long credit complete or refused`, safe(await probe()), await probe());
    await press('8', 'Digit8', 56, '8'); await sleep(700);
    state = await probe();
    check(`${name}: RTL fixture right-to-left and complete, or refused`,
      safe(state) && (!state.shown || state.direction === 'rtl'), state);
    await screenshot(`${page.replace('.html', '')}-${width}x${height}-rtl`);
  }

  await viewport(1280, 720);
  await open();
  for (const name of ['missing', 'failure']) {
    await choose('short'); await sleep(700);
    await choose(name); await sleep(400);
    const state = await probe();
    check(`${name} clears the previous display`, state.hidden && /unavailable/.test(state.status), state);
  }
  await choose('slow'); await sleep(300);
  let state = await probe();
  check('loading content is hidden from view and accessibility', state.hidden || !state.shown, state);
  await evaluate(`document.querySelector('#hide').click()`); await sleep(2000);
  state = await probe();
  check('hide during slow load: late result never appears', state.hidden && state.status === 'Display hidden.', state);
  await choose('slow'); await sleep(200); await choose('short'); await sleep(2200);
  state = await probe();
  check('newer selection wins over a stale slow load', state.shown && state.text.startsWith(FIXTURE), state);
  await choose('timeout'); await sleep(3600);
  state = await probe();
  check('timeout clears to unavailable', state.hidden && /unavailable/.test(state.status), state);

  await choose('short'); await sleep(700);
  await viewport(1200, 720); await sleep(800);
  state = await probe();
  check('viewport change hides and does not auto-resume', state.hidden, state);
  await viewport(1280, 720);
  await choose('short'); await sleep(700);
  await press('Escape', 'Escape', 27); await sleep(200);
  state = await probe();
  check('Escape hides', state.hidden && state.status === 'Display hidden.', state);
  await open();
  await press('Tab', 'Tab', 9); await sleep(100);
  state = await probe();
  check('first Tab reaches the first control', state.focused === 'Show demo', state);
  await press('Enter', 'Enter', 13, '\r'); await sleep(700);
  state = await probe();
  check('keyboard Enter shows the demo', state.shown, state);

  await open('#short'); await sleep(900);
  state = await probe();
  check('#short starts the demo on load', state.shown, state);

  await open('', 'output.html');
  state = await evaluate(`({ canvas: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
    chrome: [...document.querySelectorAll('button, nav, header, h1, .canvas-note')].length,
    statusVisible: document.querySelector('#status').getBoundingClientRect().width > 1,
    scrolls: document.documentElement.scrollHeight > innerHeight })`);
  check('output view: transparent canvas, no controls, no scroll, status off-canvas',
    state.canvas === 'rgba(0, 0, 0, 0)' && state.body === 'rgba(0, 0, 0, 0)' && !state.chrome && !state.statusVisible && !state.scrolls, state);
  // OBS composites the page without a default backdrop; anything still painted is opaque on stream.
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await open('', 'index.html');
  const control = firstPixelAlpha(Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  check('control: opaque inspection page reads as opaque', control === 255, { control });
  await open('', 'output.html');
  await press('1', 'Digit1', 49, '1'); await sleep(700);
  const corner = firstPixelAlpha(Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await screenshot('output-transparent');
  await send('Emulation.setDefaultBackgroundColorOverride', {});
  check('output view: canvas outside the panel is actually transparent', corner === 0, { corner });
  await press('Escape', 'Escape', 27); await sleep(200);
  check('output view: Escape hides', (await probe()).hidden);
  await open('#rtl', 'output.html'); await sleep(900);
  state = await probe();
  check('output view: #rtl autostarts for a Browser Source URL', state.shown && state.direction === 'rtl', state);
  check('no page errors or CSP violations', problems.length === 0, problems);
} finally {
  await session.close();
}
const failed = results.filter(result => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} browser checks passed${shots ? `; screenshots in ${shots}` : ''}.`);
process.exit(failed ? 1 : 0);

// Alpha of pixel (0,0) in an 8-bit RGBA PNG. Every PNG filter leaves the first pixel raw.
function firstPixelAlpha(png) {
  const chunks = [];
  let colorType;
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR') colorType = png[offset + 17];
    if (type === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  return colorType === 6 ? inflateSync(Buffer.concat(chunks))[4] : 255;
}
