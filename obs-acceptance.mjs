// Native OBS acceptance through obs-websocket (built into OBS 28+). Builds a temporary
// scene with a Browser Source, loads each fixture by URL hash, captures OBS's own
// render of the source and decodes its pixels. Removes the scene afterwards.
// Usage: OBS_WS_PASSWORD=… node obs-acceptance.mjs [--screenshots <dir>]
// Optional live passage: also set YVP_APP_KEY (run from any directory; the SDK is
// loaded from sdk-check/). Live screenshots contain Scripture: review, then delete.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { startServer, root, sleep } from './chrome-devtools.mjs';

const password = process.env.OBS_WS_PASSWORD;
if (!password) { console.error('Set OBS_WS_PASSWORD (OBS → Tools → WebSocket Server Settings).'); process.exit(2); }
setTimeout(() => { console.error('OBS acceptance exceeded 3 minutes.'); process.exit(3); }, 180000).unref();
const shotsArg = process.argv.indexOf('--screenshots');
const shots = shotsArg > 0 ? process.argv[shotsArg + 1] : null;
const SCENE = 'Scripture surface acceptance (temporary)';
const SOURCE = 'Scripture surface browser';

// --- obs-websocket v5 client ---
const socket = new WebSocket(`ws://127.0.0.1:${process.env.OBS_WS_PORT || 4455}`);
const pending = new Map();
let nextId = 0;
let identified;
const ready = new Promise((resolve, reject) => { identified = { resolve, reject }; });
const sha = value => createHash('sha256').update(value).digest('base64');
socket.onmessage = ({ data }) => {
  const { op, d } = JSON.parse(data);
  if (op === 0) {
    const authentication = d.authentication &&
      sha(sha(password + d.authentication.salt) + d.authentication.challenge);
    socket.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, authentication, eventSubscriptions: 0 } }));
  } else if (op === 2) identified.resolve();
  else if (op === 7 && pending.has(d.requestId)) {
    const { resolve, reject } = pending.get(d.requestId);
    pending.delete(d.requestId);
    d.requestStatus.result ? resolve(d.responseData || {}) : reject(new Error(`${d.requestType}: ${d.requestStatus.comment || d.requestStatus.code}`));
  }
};
socket.onclose = event => identified.reject(new Error(`obs-websocket closed (${event.code})`));
socket.onerror = () => identified.reject(new Error('Cannot reach obs-websocket; is OBS running with the server enabled?'));
const call = (requestType, requestData = {}) => new Promise((resolve, reject) => {
  const requestId = String(++nextId);
  pending.set(requestId, { resolve, reject });
  socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
});

// --- PNG decoding (8-bit RGBA, all five filter types) ---
function decodePng(png) {
  let width, height, colorType, depth;
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR') {
      width = png.readUInt32BE(offset + 8); height = png.readUInt32BE(offset + 12);
      depth = png[offset + 16]; colorType = png[offset + 17];
    }
    if (type === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  if (depth !== 8 || colorType !== 6) throw new Error(`Unsupported PNG (depth ${depth}, color ${colorType})`);
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * 4, pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? pixels[y * stride + x - 4] : 0, b = y ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y ? pixels[(y - 1) * stride + x - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      pixels[y * stride + x] = (line[x] + predictor) & 255;
    }
  }
  return { width, height, alpha: (x, y) => pixels[(y * width + x) * 4 + 3],
    opaqueFraction() { let n = 0; for (let i = 3; i < pixels.length; i += 4) n += pixels[i] > 0; return n / (width * height); } };
}

const results = [];
const check = (name, pass, detail = '') => {
  results.push(Boolean(pass));
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass || !detail ? '' : ` — ${JSON.stringify(detail)}`}`);
};

async function render(url, width, height, label) {
  // Empty custom CSS: test the page's own transparency, not OBS's default override.
  await call('SetInputSettings', { inputName: SOURCE, overlay: true,
    inputSettings: { is_local_file: false, url, width, height, css: '', shutdown: true } });
  await call('SetSceneItemTransform', { sceneName: SCENE, sceneItemId: item,
    sceneItemTransform: { positionX: 0, positionY: 0, scaleX: 1, scaleY: 1 } });
  await sleep(500);
  await call('PressInputPropertiesButton', { inputName: SOURCE, propertyName: 'refreshnocache' });
  // Wait until the page has settled: two identical frames after the load window.
  let image, png, previous;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const { imageData } = await call('GetSourceScreenshot', { sourceName: SOURCE, imageFormat: 'png' });
    png = Buffer.from(imageData.split(',')[1], 'base64');
    image = decodePng(png);
    const fraction = image.opaqueFraction();
    if (i >= 5 && fraction === previous) break;
    previous = fraction;
  }
  if (shots) {
    await mkdir(shots, { recursive: true });
    await writeFile(join(shots, `obs-${label}.png`), png);
  }
  return image;
}

let item, previousScene, server;
await ready;
try {
  const version = await call('GetVersion');
  console.log(`OBS ${version.obsVersion}, obs-websocket ${version.obsWebSocketVersion}, ${version.platformDescription}`);
  previousScene = (await call('GetCurrentProgramScene')).currentProgramSceneName;
  const { scenes } = await call('GetSceneList');
  if (scenes.some(scene => scene.sceneName === SCENE)) await call('RemoveScene', { sceneName: SCENE });
  await call('CreateScene', { sceneName: SCENE });
  await call('SetCurrentProgramScene', { sceneName: SCENE });
  ({ sceneItemId: item } = await call('CreateInput', { sceneName: SCENE, inputName: SOURCE,
    inputKind: 'browser_source', inputSettings: { width: 1280, height: 720, css: '' } }));

  // OBS refuses file:// in URL mode; its Local file mode serves files at
  // http://absolute/<path>, which also accepts a #fixture hash.
  const page = `http://absolute${pathToFileURL(join(root, 'output.html')).pathname}`;
  // Preflight: the opaque inspection page must draw. On macOS (OBS 32.2.2, 2026-10-08),
  // if no Browser Source existed when OBS launched, one created over obs-websocket
  // never starts CEF and every source stays blank.
  const preflight = await render(`http://absolute${pathToFileURL(join(root, 'index.html')).pathname}`, 1280, 720, 'preflight');
  if (preflight.opaqueFraction() < 0.9) {
    throw new Error('OBS Browser Sources are not drawing. Add any Browser Source to a scene in OBS ' +
      '(or keep a hidden one saved), restart OBS, and run this again.');
  }
  for (const [width, height] of [[1280, 720], [1920, 1080]]) {
    const size = `${width}x${height}`;
    let image = await render(`${page}#short`, width, height, `${size}-short`);
    const shown = image.opaqueFraction();
    check(`${size}: http://absolute/…/output.html#short renders the panel at the source size`,
      image.width === width && image.height === height && shown > 0.1 && shown < 0.7, { width: image.width, height: image.height, shown });
    check(`${size}: canvas above the panel is transparent`, image.alpha(0, 0) === 0 && image.alpha(width >> 1, height >> 3) === 0);
    check(`${size}: panel area is opaque`, image.alpha(width >> 1, height - Math.round(height * 0.12)) === 255);
    image = await render(`${page}#rtl`, width, height, `${size}-rtl`);
    check(`${size}: RTL fixture renders`, image.opaqueFraction() > 0.05);
    image = await render(`${page}#long`, width, height, `${size}-long`);
    check(`${size}: overflow is refused: nothing visible on the canvas`, image.opaqueFraction() === 0, { opaque: image.opaqueFraction() });
  }

  if (process.env.YVP_APP_KEY) {
    const sdk = await import(pathToFileURL(join(root, 'sdk-check/node_modules/@youversion/platform-core/dist/index.js')).href);
    const { createPlatformLoader } = await import('./platform-adapter.mjs');
    const html = (await import('node:fs')).readFileSync(join(root, 'live.html'), 'utf8');
    const selection = { versionId: Number(/data-version-id="(\d+)"/.exec(html)[1]), passageId: /data-passage-id="([A-Z0-9.\-]+)"/.exec(html)[1] };
    const load = createPlatformLoader(new sdk.BibleClient(new sdk.ApiClient({ appKey: process.env.YVP_APP_KEY })), { opening: selection });
    const display = await load('opening');
    server = await startServer({ routes: { '/display.json': { type: 'application/json', body: JSON.stringify(display) } } });
    for (const [width, height] of [[1280, 720], [1920, 1080]]) {
      const image = await render(`${server.base}live.html#show`, width, height, `${width}x${height}-live`);
      check(`${width}x${height}: live passage renders in OBS with transparent surround`,
        image.opaqueFraction() > 0.05 && image.alpha(0, 0) === 0, { opaque: image.opaqueFraction() });
    }
  }
} finally {
  if (previousScene) await call('SetCurrentProgramScene', { sceneName: previousScene }).catch(() => {});
  await call('RemoveScene', { sceneName: SCENE }).catch(() => {});
  await call('RemoveInput', { inputName: SOURCE }).catch(() => {});
  server?.close();
  socket.close();
}
const failed = results.filter(pass => !pass).length;
console.log(`\n${results.length - failed}/${results.length} OBS checks passed.`);
process.exit(failed ? 1 : 0);
