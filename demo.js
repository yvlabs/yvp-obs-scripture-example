/* Fixed synthetic fixtures only. No query/message payloads, keys or network. */
'use strict';
const panel = document.querySelector('#panel');
const content = document.querySelector('#content');
const attribution = document.querySelector('#attribution');
const status = document.querySelector('#status');
const fixture = {
  html: '<p>This is a synthetic layout sample. A live integration must show the selected passage exactly as the Platform supplies it, together with its required attribution.</p>',
  attribution: { text: 'Synthetic fixture • Bibleinator Labs • No Bible text or publisher license represented.' },
  stylesheets: [], // Synthetic mode only. Live models must include SDK resources.
  containerAttributes: { 'data-slot': 'yv-bible-renderer', 'data-yv-sdk': '', lang: 'en', dir: 'ltr' },
};
const view = SurfaceView.createDisplayView({ document, panel, content, attribution, status,
  allowEmptyStylesheets: true,
});
const controller = SurfaceDemo.createController({
  timeoutMs: 3000,
  load: async (selection, { signal }) => {
    if (selection === 'failure') throw new Error('Synthetic failure');
    if (selection === 'timeout') return new Promise(() => {});
    if (selection === 'slow') {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 1500);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Cancelled')); }, { once: true });
      });
    }
    if (selection === 'missing') return { ...fixture, attribution: { text: '' } };
    if (selection === 'long') return { ...fixture, html: `<p>${'Synthetic overflow test. '.repeat(500)}</p>` };
    if (selection === 'credit') return { ...fixture, attribution: { text: 'Synthetic long credit. '.repeat(160) } };
    if (selection === 'rtl') return { ...fixture,
      html: '<p>نص تجريبي للتخطيط فقط — ليس نصًا كتابيًا.</p>',
      containerAttributes: { ...fixture.containerAttributes, lang: 'ar', dir: 'rtl' },
    };
    return fixture;
  },
  view,
});
// Keys 1–8 follow this order on both pages; output.html has no visible buttons.
const cases = ['short', 'long', 'missing', 'failure', 'slow', 'timeout', 'credit', 'rtl'];
view.clear();
document.querySelectorAll('[data-case]').forEach(button => {
  button.addEventListener('click', () => controller.show(button.dataset.case));
});
document.querySelector('#hide')?.addEventListener('click', () => controller.hide());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') controller.hide();
  else if (/^[1-8]$/.test(event.key) && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
    controller.show(cases[Number(event.key) - 1]);
  }
});
window.addEventListener('resize', () => controller.hide());
document.fonts.addEventListener('loading', () => {
  if (!panel.hidden && !panel.inert) controller.hide();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) controller.hide(); });
// Guard later layout changes as well as the initial measurement. No auto-reshow.
if (typeof ResizeObserver !== 'undefined') {
  const observer = new ResizeObserver(() => {
    if (!panel.hidden && !panel.inert && !view.fitsNow()) controller.hide();
  });
  [panel, content, attribution].forEach(element => observer.observe(element));
}
const initial = location.hash.slice(1);
if (cases.includes(initial)) controller.show(initial);
