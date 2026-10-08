/* Trusted SDK display models or authored fixtures only; never arbitrary HTML. */
(function (root) {
  'use strict';
  const contract = typeof module !== 'undefined' && module.exports
    ? require('./display-contract.js') : root.SurfaceDisplay;
  function createDisplayView({ document, panel, content, attribution, status,
    allowStylesheet = () => false, allowEmptyStylesheets = false,
    frame = () => new Promise(resolve => document.defaultView.requestAnimationFrame(resolve)),
  }) {
    let links = [];
    let attributes = [];
    let cancelResources = () => {};
    // Internal overflow alone is not enough: a panel partly outside the viewport
    // (and therefore an OBS canvas) would be cropped without any refusal.
    const onScreen = () => {
      const box = panel.getBoundingClientRect();
      const view = document.defaultView;
      return box.top >= 0 && box.left >= 0 && box.bottom <= view.innerHeight && box.right <= view.innerWidth;
    };
    const fitsNow = () => !panel.hidden && panel.clientWidth > 0 && panel.clientHeight > 0 &&
      [panel, content, attribution, ...content.querySelectorAll('*')].every(element =>
        element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight) &&
      onScreen();
    function clear() {
      cancelResources();
      cancelResources = () => {};
      panel.hidden = true;
      panel.inert = true;
      panel.classList.add('measuring');
      panel.setAttribute('aria-hidden', 'true');
      content.replaceChildren();
      attribution.textContent = '';
      for (const name of attributes) content.removeAttribute(name);
      attributes = [];
      for (const link of links) link.remove();
      links = [];
    }
    return {
      clear,
      status(message) { status.textContent = message; },
      async prepare(display, { signal } = {}) {
        contract.validateDisplay(display, { allowEmptyStylesheets });
        if (signal?.aborted || display.stylesheets.some(sheet => !allowStylesheet(sheet))) {
          throw new Error('Resources unavailable');
        }
        // clear() is called by the controller before prepare; all nodes are owned
        // by this view. Each display reloads resources, including changed font URLs.
        content.innerHTML = display.html;
        attribution.textContent = display.attribution.text;
        for (const [name, value] of Object.entries(display.containerAttributes)) {
          content.setAttribute(name, value);
          attributes.push(name);
        }
        panel.classList.add('measuring');
        panel.inert = true;
        panel.setAttribute('aria-hidden', 'true');
        panel.hidden = false;
        const cancels = [];
        cancelResources = () => cancels.forEach(cancel => cancel());
        await Promise.all(display.stylesheets.map(sheet => new Promise((resolve, reject) => {
          const link = document.createElement('link');
          let settled = false;
          const finish = error => {
            if (settled) return;
            settled = true;
            link.onload = null;
            link.onerror = null;
            signal?.removeEventListener('abort', cancel);
            error ? reject(new Error('Resources unavailable')) : resolve();
          };
          const cancel = () => finish(true);
          cancels.push(cancel);
          signal?.addEventListener('abort', cancel, { once: true });
          link.rel = sheet.rel;
          link.href = sheet.href;
          link.onload = () => finish(false);
          link.onerror = () => finish(true);
          links.push(link);
          document.head.append(link);
        })));
      },
      async fits() {
        await document.fonts.ready;
        await frame();
        return fitsNow();
      },
      fitsNow,
      reveal() {
        panel.classList.remove('measuring');
        panel.inert = false;
        panel.removeAttribute('aria-hidden');
      },
    };
  }
  root.SurfaceView = { createDisplayView };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SurfaceView;
})(globalThis);
