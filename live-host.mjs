// Browser half of a server-fetched live host. The server holds the App Key for API
// calls and returns the SDK's display model at display.json; this page renders it.
// The SDK's font stylesheet URL still carries the key (see docs/operator-guide.md).
import { mountPlatformSurface } from './mount.mjs';

const { versionId, passageId } = document.body.dataset;
const selection = { versionId: Number(versionId), passageId };
const surface = mountPlatformSurface({
  bibleClient: {
    async getPassageDisplay(options) {
      const query = new URLSearchParams({ version: options.versionId, passage: options.passageId });
      const response = await fetch(`display.json?${query}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Display unavailable');
      return response.json();
    },
  },
  selections: { opening: selection },
  document,
  elements: {
    panel: document.querySelector('#panel'),
    content: document.querySelector('#content'),
    attribution: document.querySelector('#attribution'),
    status: document.querySelector('#status'),
  },
  allowedStylesheetOrigins: ['https://cdn.youversion.com', 'https://api.youversion.com'],
});
document.addEventListener('keydown', event => {
  if (event.key === '1' && !event.repeat) surface.show('opening');
});
if (location.hash === '#show') surface.show('opening');
