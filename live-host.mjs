// Browser half of a server-fetched live host. The server holds the App Key for API
// calls and returns the SDK's display model at display.json; this page renders it.
// The SDK's font stylesheet URL still carries the key (see docs/operator-guide.md).
//   live.html#show     show the passage the server has, once
//   live.html#control  follow the control page: show, switch and hide as the operator does
import { mountPlatformSurface } from './mount.mjs';

const { versionId, passageId } = document.body.dataset;
const panel = document.querySelector('#panel');
const status = document.querySelector('#status');
const surface = mountPlatformSurface({
  bibleClient: {
    // Always the passage currently on air; the server decides what that is.
    async getPassageDisplay() {
      const response = await fetch('display.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Display unavailable');
      return response.json();
    },
  },
  // The adapter needs a configured selection; in control mode the server chooses the passage.
  selections: { opening: { versionId: Number(versionId), passageId } },
  // These calls reach only this page's own server, which caps Platform requests itself.
  requestPolicy: { minIntervalMs: 0, maxCalls: 10000 },
  document,
  elements: { panel, content: document.querySelector('#content'),
    attribution: document.querySelector('#attribution'), status },
  allowedStylesheetOrigins: ['https://cdn.youversion.com', 'https://api.youversion.com'],
});
document.addEventListener('keydown', event => {
  if (event.key === '1' && !event.repeat) surface.show('opening');
});

if (location.hash === '#show') surface.show('opening');
if (location.hash === '#control') {
  let generation = null;
  // Tell the control page what viewers actually see once each change settles.
  const report = () => {
    const text = status.textContent;
    const state = !panel.hidden && !panel.inert ? 'visible'
      : /do not fit/.test(text) ? 'refused'
      : /unavailable/.test(text) ? 'unavailable'
      : /hidden/i.test(text) ? 'hidden' : null;
    if (state && generation !== null) {
      fetch('api/output', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ generation, state }) }).catch(() => {});
    }
  };
  new MutationObserver(report).observe(status, { childList: true, characterData: true, subtree: true });
  const events = new EventSource('events?role=output');
  events.addEventListener('change', async event => {
    const data = JSON.parse(event.data);
    generation = data.generation;
    if (data.onAir) await surface.show('opening');
    else surface.hide();
    report();
  });
}
