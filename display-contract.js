/* Data validation only. This is not an HTML sanitizer. */
(function (root) {
  'use strict';
  function validateDisplay(display, { allowEmptyStylesheets = false, maxBytes = 262144 } = {}) {
    const text = value => typeof value === 'string' && value.trim().length > 0;
    const attrs = display?.containerAttributes;
    if (!text(display?.html) || !text(display?.attribution?.text) ||
        !Array.isArray(display.stylesheets) || display.stylesheets.length > 8 ||
        (!allowEmptyStylesheets && !display.stylesheets.length) ||
        !attrs || typeof attrs !== 'object' || Array.isArray(attrs) ||
        Object.keys(attrs).length > 32) throw new Error('Incomplete Platform display');
    if (new TextEncoder().encode(display.html + display.attribution.text).length > maxBytes) {
      throw new Error('Display exceeds size limit');
    }
    // Reject unsupported attributes rather than silently stripping SDK semantics.
    for (const [name, value] of Object.entries(attrs)) {
      if (!/^(data-[a-z0-9-]+|lang|dir|class)$/.test(name) || typeof value !== 'string' ||
          value.length > 2048 || (name === 'dir' && !['ltr', 'rtl', 'auto'].includes(value))) {
        throw new Error('Unsupported container attribute');
      }
    }
    if (attrs['data-slot'] !== 'yv-bible-renderer' || !Object.hasOwn(attrs, 'data-yv-sdk')) {
      throw new Error('Incomplete Platform display');
    }
    for (const sheet of display.stylesheets) {
      if (!text(sheet?.href) || !text(sheet?.kind) || sheet.rel !== 'stylesheet' || sheet.href.length > 8192) {
        throw new Error('Incomplete stylesheet');
      }
    }
    return display; // Preserve original HTML, attribution, attributes and resource URLs.
  }
  root.SurfaceDisplay = { validateDisplay };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SurfaceDisplay;
})(globalThis);
