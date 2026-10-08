// Live host: the control server (../control-server.mjs) wired to the pinned SDK.
// Starts with the passage named in live.html on air, then follows the control page.
// Needs YVP_APP_KEY (never printed). Usage: YVP_APP_KEY=… node serve-live.mjs [port]
import { readFileSync } from 'node:fs';
import { ApiClient, BibleClient } from '@youversion/platform-core';
import { createPlatformLoader } from '../platform-adapter.mjs';
import { startControlServer } from '../control-server.mjs';

const key = process.env.YVP_APP_KEY;
if (!key) { console.error('Set YVP_APP_KEY for an app you operate.'); process.exit(2); }
const client = new BibleClient(new ApiClient({ appKey: key }));
// One validated selection per request; the control server caps how often this runs.
const load = selection => createPlatformLoader(client, { pick: selection }, { minIntervalMs: 0 })('pick');

const page = readFileSync(new URL('../live.html', import.meta.url), 'utf8');
const initial = {
  versionId: Number(/data-version-id="(\d+)"/.exec(page)[1]),
  passageId: /data-passage-id="([A-Z0-9.\-]+)"/.exec(page)[1],
};
const server = await startControlServer({ load, port: Number(process.argv[2]) || 0 });
try {
  await server.show(initial.passageId, initial.versionId);
} catch {
  console.error(`Could not load ${initial.passageId} (version ${initial.versionId}); starting with nothing on air.`);
}
console.log(`Control page:  ${server.base}`);
console.log(`OBS Browser Source URL:  ${server.base}live.html#control`);
