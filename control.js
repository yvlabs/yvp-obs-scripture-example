/* Operator control page: sends show/hide to this server and mirrors what the overlay
   reports. Shows references only, never passage text. */
'use strict';
const $ = selector => document.querySelector(selector);
const form = $('#form'), reference = $('#reference'), version = $('#version');
const message = $('#message'), output = $('#output'), onAir = $('#on-air'), recent = $('#recent');
const OUTPUT = {
  visible: 'On screen',
  refused: 'Too long for the canvas: not shown. Choose a shorter passage.',
  unavailable: 'The overlay could not display it.',
  hidden: 'Hidden',
};
let busy = false;

function render(state) {
  onAir.textContent = state.onAir
    ? `${state.onAir.reference} · ${state.onAir.abbreviation || `version ${state.onAir.versionId}`}`
    : 'Nothing';
  const key = !state.overlays ? 'none' : state.output || 'pending';
  output.dataset.state = key;
  output.textContent = key === 'none' ? 'No overlay connected. In OBS, use live.html#control.'
    : key === 'pending' ? (state.onAir ? 'Updating the overlay…' : 'Hidden') : OUTPUT[key];
  recent.replaceChildren(...state.recent.map(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = item.versionId === Number(version.value) ? item.reference : `${item.reference} (${item.versionId})`;
    button.addEventListener('click', () => send('show', item));
    return button;
  }));
}

async function send(action, body = {}) {
  if (busy) return;
  busy = true;
  message.textContent = '';
  form.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(`api/${action}`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const state = await response.json();
    if (!response.ok) message.textContent = state.error || 'Something went wrong.';
    if (state.recent) render(state);
  } catch {
    message.textContent = 'The control server is not reachable. Is serve-live.mjs running?';
  } finally {
    busy = false;
    form.removeAttribute('aria-busy');
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  send('show', { reference: reference.value, versionId: Number(version.value) });
});
$('#hide').addEventListener('click', () => send('hide'));
const events = new EventSource('events?role=control');
for (const type of ['change', 'state']) events.addEventListener(type, event => render(JSON.parse(event.data)));
events.addEventListener('error', () => { output.dataset.state = 'none'; output.textContent = 'Reconnecting to the control server…'; });
