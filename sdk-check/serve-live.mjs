// Live host server for OBS: fetches the selection named in live.html once through the
// pinned SDK and this example's adapter, then serves the example folder on loopback.
// Needs YVP_APP_KEY (never printed). Point an OBS Browser Source at the printed URL.
// Usage: YVP_APP_KEY=… node serve-live.mjs [port]   — stop with Ctrl-C.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiClient, BibleClient } from '@youversion/platform-core';
import { createPlatformLoader } from '../platform-adapter.mjs';
import { startServer, root } from '../chrome-devtools.mjs';

const key = process.env.YVP_APP_KEY;
if (!key) { console.error('Set YVP_APP_KEY for an app you operate.'); process.exit(2); }
const page = readFileSync(join(root, 'live.html'), 'utf8');
const selection = {
  versionId: Number(/data-version-id="(\d+)"/.exec(page)[1]),
  passageId: /data-passage-id="([A-Z0-9.\-]+)"/.exec(page)[1],
};
let display;
try {
  display = await createPlatformLoader(new BibleClient(new ApiClient({ appKey: key })), { opening: selection })('opening');
} catch {
  console.error('Platform display unavailable for the configured selection (no details printed).');
  process.exit(1);
}
const server = await startServer({ port: Number(process.argv[2]) || 0,
  routes: { '/display.json': { type: 'application/json', body: JSON.stringify(display) } } });
console.log(`Serving ${selection.passageId} (version ${selection.versionId}) at ${server.base}live.html#show`);
