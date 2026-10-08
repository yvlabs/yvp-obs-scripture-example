// Glue for an operator-owned browser host. No SDK, credentials or network setup.
import './display-contract.js';
import './controller.js';
import './view.js';
import { createPlatformLoader } from './platform-adapter.mjs';

export function mountPlatformSurface({ bibleClient, selections, document,
  elements, allowedStylesheetOrigins, timeoutMs = 15000, requestPolicy = {},
}) {
  if (!Array.isArray(allowedStylesheetOrigins) || !allowedStylesheetOrigins.length ||
      allowedStylesheetOrigins.some(origin => {
        try { const url = new URL(origin); return url.protocol !== 'https:' || url.origin !== origin; }
        catch { return true; }
      })) throw new Error('Configure exact HTTPS stylesheet origins');
  const origins = new Set(allowedStylesheetOrigins);
  const load = createPlatformLoader(bibleClient, selections, requestPolicy);
  const view = globalThis.SurfaceView.createDisplayView({ document, ...elements,
    allowStylesheet(sheet) {
      try {
        const url = new URL(sheet.href);
        return url.protocol === 'https:' && !url.username && !url.password && origins.has(url.origin);
      } catch { return false; }
    },
  });
  const controller = globalThis.SurfaceDemo.createController({ load, view, timeoutMs,
    messages: { loading: 'Loading selected passage…', visible: 'Selected passage and attribution visible.' },
  });
  const resize = () => controller.hide();
  const keydown = event => { if (event.key === 'Escape') controller.hide(); };
  const hidden = () => { if (document.hidden) controller.hide(); };
  const fonts = () => { if (!elements.panel.hidden && !elements.panel.inert) controller.hide(); };
  document.defaultView.addEventListener('resize', resize);
  document.addEventListener('keydown', keydown);
  document.addEventListener('visibilitychange', hidden);
  document.fonts.addEventListener('loading', fonts);
  const Observer = document.defaultView.ResizeObserver;
  const observer = Observer && new Observer(() => {
    if (!elements.panel.hidden && !elements.panel.inert && !view.fitsNow()) controller.hide();
  });
  if (observer) [elements.panel, elements.content, elements.attribution].forEach(element => observer.observe(element));
  controller.hide();
  let disposed = false;
  return {
    show(name) { return disposed ? Promise.resolve() : controller.show(name); },
    hide: controller.hide,
    dispose() {
      disposed = true;
      controller.hide();
      observer?.disconnect();
      document.defaultView.removeEventListener('resize', resize);
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('visibilitychange', hidden);
      document.fonts.removeEventListener('loading', fonts);
    },
  };
}
