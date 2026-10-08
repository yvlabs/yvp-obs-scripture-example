# Operator guide

For whoever runs this overlay on a real stream or screen: setup decisions, the
facts we verified about the SDK and its CSS, and what to test on your own host.

## 1. Decide the use, and own it

You own your Platform app registration, the Bible version licenses, support, quota
and misuse response, and key replacement. Decide what this is: a private room
display, a live stream, recorded video, an archive, a sponsored event or something
else. This code's license and a successful API response do not establish the
right to show a translation in any of those. Check the current
[Platform terms](https://platform.youversion.com) and the publisher's license for
your use. Do not invent publisher notices; show what the Platform returns.

Get an App Key from [platform.youversion.com](https://platform.youversion.com) and
read the [Display Bible HTML guide](https://developers.youversion.com/guides/display-bible-html).

## 2. Configure the host

- Keep the key out of source control. `sdk-check/serve-live.mjs` reads it from the
  `YVP_APP_KEY` environment variable and never prints it.
- **The key is visible to the browser.** The SDK's font stylesheet URL is
  `https://api.youversion.com/v1/fonts/1/stylesheet?app_key=<key>`. Fetching the
  passage on a server keeps the key out of API calls, but not out of that URL.
  Decide explicitly whether that is acceptable for your app; don't log or
  screenshot the stylesheet URL.
- Allow only the reviewed origins in your CSP. `live.html` allows
  `cdn.youversion.com` and `api.youversion.com` (Bible CSS, font stylesheet, font
  files), and `fonts.googleapis.com` and `fonts.gstatic.com` (the Bible CSS imports
  Google Fonts). `mount.mjs` additionally checks stylesheet origins exactly.
- Do not download or self-host the Platform's fonts or CSS. A resource that fails
  to load hides the whole display.
- Pin the SDK and its lockfile. When you change the pin, rerun `sdk-check`.

## 3. Verify your selection and limits

- Check the catalog **and** your app's access with a real passage request.
  Version metadata can succeed when passage access is denied.
- Verify Go Live status and current quotas before production. Each display makes
  two API calls (passage and version), plus two stylesheet loads and their fonts.
  The control server allows one passage load per second and 120 per hour; the
  adapter alone defaults to 30 per hour. These are local safety limits, not
  Platform quotas.
- SDK 2.15.0 aborts each request after `timeout` (default 10 seconds) and does not
  retry or honour `Retry-After`. This adapter adds no retries and no fallback
  version.

## 4. Accept your actual host

Test complete content and credit at your canvas sizes, plus:

- long passages and long notices, footnotes and links;
- right-to-left text and language tags;
- slow fonts and stylesheets, denied access, quota exhaustion, network loss and
  late responses;
- source hide/show, resize and disposal.

Confirm the whole panel fits inside the **uncropped** OBS source. Never split,
truncate or shrink Scripture or its credit to force a fit: choose a shorter
complete passage or a larger canvas. `browser-acceptance.mjs`,
`sdk-check/live-acceptance.mjs` and `obs-acceptance.mjs` automate most of this.

## SDK facts (verified against `@youversion/platform-core` 2.15.0)

- `BibleClient.getPassageDisplay({ versionId, passageId, includeHeadings,
  includeNotes })` returns `{ version, html, attribution, stylesheets,
  containerAttributes }`. The validator accepts it unchanged.
- Attribution is the version's `copyright`, falling back to `promotional_content`.
  If both are blank, the SDK throws `MissingPassageAttributionError` and nothing is
  shown.
- In Node, the SDK needs `jsdom` to transform passage HTML (pinned in `sdk-check`).
  Browsers use their built-in DOM.

## Rendering facts (verified with live Platform CSS, October 2026)

- **Typeface.** The display guide names Untitled Serif (font ID 1) as the intended
  Bible typeface, but `bible.css` defaults to Source Serif 4. Set
  `--yv-reader-font-family: "Untitled Serif", "Source Serif 4", serif` on the
  renderer container, as `overlay.css` does.
- **Host CSS must not override the SDK.** The Bible CSS uses cascade layers, so any
  unlayered host `font` or `white-space` rule on the container wins over it.
  `overlay.css` keeps its fixture styling in a layer declared first (lowest
  priority) and sets only the documented reader tokens on live content.
- **Width.** The guide documents `--yv-reader-max-width`, but `bible.css` currently
  caps renderer children with `--yv-container-lg` (32rem) instead. The OBS output
  view sets both so the passage uses the canvas width. This only changes the line
  length, never the text.
