# What has been verified

As of October 8, 2026. Each script prints pass/fail only; none prints passage text
or keys.

| Check | Environment | Result |
|---|---|---|
| `node --test *.test.*` | Node 22, simulated DOM | 30/30 |
| `browser-acceptance.mjs` | Headless Google Chrome, loopback server | 49/49 |
| `sdk-check` `npm test` | `@youversion/platform-core` 2.15.0, `jsdom` 28.1.0, stubbed fetch | 3/3 |
| `sdk-check/live-acceptance.mjs` | Real Platform, version 3034 (BSB), `JHN.3.16`, headless Chrome | 23/23 |
| `obs-acceptance.mjs` | OBS 32.2.2, obs-websocket 5.7.4, macOS 26.6.2, Apple silicon | 12/12 |

**Browser (49 checks).** Both pages at 1280×720, 1920×1080, 640×360 (the viewport
at 200% zoom) and 375×667:

- the demo is fully visible at OBS sizes, and overflow is refused;
- long credit and right-to-left text are complete and on screen, or refused;
- missing attribution and failures clear the display;
- a hide during a slow load stays hidden, and a newer selection beats a stale one;
- timeout, resize without auto-resume, Escape, Tab/Enter, and `#case` autostart;
- the output page has a truly transparent canvas, measured from pixel alpha.

No page errors or CSP violations.

**Live (23 checks).** At three sizes, against the real Platform:

- the HTML is identical to the SDK's (both parsed by the browser), and so is the
  credit;
- the SDK container attributes are present;
- both stylesheets loaded, and Untitled Serif was loaded and used;
- the passage fits;
- the key is absent from the visible text, and there were no CSP violations.

**OBS (12 checks).** At 1280×720 and 1920×1080, from OBS's own render of the
Browser Source:

- the panel is drawn at the source size, with alpha 0 outside it;
- the right-to-left fixture renders;
- an overflowing fixture leaves the canvas completely empty;
- the live passage renders with a transparent surround.

Results were the same with browser hardware acceleration on and off.

**Defects these checks found and fixed during development:**

- A panel extending past the viewport edge was revealed, which OBS would crop.
- Host CSS overrode the Platform typeface and applied `white-space: pre-wrap` to
  SDK markup.

**Not verified:**

- screen readers;
- OBS on Windows and Linux;
- OBS source cropping or transforms;
- licensed, non-public-domain versions;
- quotas beyond a handful of calls.
