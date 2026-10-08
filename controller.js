/* Browser + Node, no dependencies. The loader is trusted code, never a message/URL. */
(function (root) {
  'use strict';
  function createController({ load, view, timeoutMs = 15000, messages = {} }) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid timeout');
    let generation = 0;
    let active;
    const copy = {
      loading: 'Loading…',
      visible: 'Demo visible — synthetic layout text, not Scripture.',
      unavailable: 'Display unavailable. Nothing is being shown.',
      ...messages,
    };
    return {
      async show(selection) {
        const request = ++generation;
        active?.abort();
        const operation = new AbortController();
        active = operation;
        const { signal } = operation;
        let timer;
        // Bound the entire load/resource/font/layout cycle, including loaders that
        // cannot cancel their underlying SDK call. Always consume late rejections.
        const aborted = new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('Display cancelled')), { once: true });
          timer = setTimeout(() => operation.abort(), timeoutMs);
        });
        const step = work => Promise.race([Promise.resolve(work), aborted]);
        view.clear();
        view.status(copy.loading);
        try {
          const display = await step(load(selection, { signal }));
          if (request !== generation) return;
          if (typeof display?.html !== 'string' || !display.html.trim() ||
              typeof display?.attribution?.text !== 'string' || !display.attribution.text.trim()) {
            throw new Error('Incomplete display');
          }
          // Never trim, summarize, split, truncate, or replace provider content.
          await step(view.prepare(display, { signal }));
          if (request !== generation) return;
          const fits = await step(view.fits({ signal }));
          if (request !== generation) return;
          if (!fits) {
            view.clear();
            view.status('Display hidden: content and attribution do not fit. Choose a shorter selection or a larger canvas.');
            return;
          }
          view.reveal();
          view.status(copy.visible);
        } catch {
          if (request !== generation) return;
          view.clear();
          // No raw exception, selection, response content, or credentials in logs/UI.
          view.status(copy.unavailable);
        } finally {
          clearTimeout(timer);
          // Also release resources if preparation failed before observing abort.
          // Successful views keep their resources until clear()/the next request.
          if (active === operation) active = null;
        }
      },
      hide() {
        generation++;
        active?.abort();
        active = null;
        view.clear();
        view.status('Display hidden.');
      },
    };
  }
  root.SurfaceDemo = { createController };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SurfaceDemo;
})(globalThis);
