# Chrome Web Store — Listing & Submission Notes

Copy/paste-ready text for the Web Store developer dashboard, plus the answers
reviewers will ask for. Not shipped in the extension package.

---

## Item name (max 75 chars)

```
Crosstalk — Frame & Socket Inspector
```

## Summary (max 132 chars)

```
See iframe postMessage and Socket.IO/WebSocket traffic together on one DevTools timeline.
```

## Category

`Developer Tools`

## Language

English (add others later if localized).

---

## Detailed description (store listing body)

```
Crosstalk is a Chrome DevTools panel for debugging apps where the host page, its
iframes, and a backend socket are all talking at once — app builders, embedded
widgets, sandboxed previews, micro-frontends.

Chrome's built-in DevTools can't help much here:
• postMessage traffic isn't logged at all.
• WebSocket frames show up only as raw engine.io blobs like 42["event",…].
• There's no way to line the two channels up in time.

Crosstalk fixes that. It observes the page's postMessage, WebSocket, and the
engine.io polling transport (no changes to your app code), decodes Socket.IO
frames into readable events, and puts everything on one filterable timeline.

FEATURES
• One timeline for postMessage + Socket.IO/WebSocket, in capture order.
• Decoded Socket.IO events — real event names and payloads, not raw frames.
• Direction at a glance: host → iframe, iframe → host, FE → BE, BE → FE.
• Captures cross-origin iframes (runs in all frames).
• Noise filter hides React/Redux DevTools, webpack HMR, and ping/pong heartbeats.
• Click a row for full payload; Shift+click a second row to measure elapsed time.
• Copy the visible log (human-readable + JSON) or a single message.
• Pause, clear, search, and channel filters.

PRIVACY
Captured data never leaves your local DevTools. No analytics, no telemetry, no
external servers. Open source (MIT).
```

---

## Privacy practices (dashboard form answers)

- **Single purpose:** A DevTools panel that displays a web page's own
  postMessage and Socket.IO/WebSocket traffic to help developers debug
  cross-frame and client/server messaging.

- **Permission justifications:**
  - `host_permissions <all_urls>` + content script `all_frames`:
    > The extension instruments postMessage / WebSocket / polling inside the
    > inspected page and its iframes. An iframe's origin is not known ahead of
    > time, and cross-origin iframe traffic can only be read from within that
    > frame, so the content script must be allowed to run in any page and any
    > frame. It is used only to read in-page messaging for display in the
    > DevTools panel; nothing is transmitted off the device.
  - `world: "MAIN"` content script:
    > WebSocket, postMessage, and XMLHttpRequest are page-context globals. They
    > must be wrapped in the page's own JS world (before page scripts run) to be
    > observed; an isolated-world script cannot see them.
  - `storage`:
    > Local UI preferences only. No captured traffic is stored.

- **Data usage disclosures:**
  - Does the extension collect user data? **No** (nothing is sent off-device).
  - Remote code? **No** — all code is in the package; nothing is fetched/eval'd.

- **Privacy policy URL:**
  ```
  https://github.com/yangban2/crosstalk/blob/main/PRIVACY.md
  ```

---

## Assets to upload

- **Store icon:** 128×128 PNG — `icons/icon128.png`.
- **Screenshots:** 1280×800 (or 640×400) PNG/JPEG, at least 1, up to 5.
  Suggested shots:
  1. Full timeline during an app generation (socket events flowing).
  2. A postMessage round-trip with host → iframe / iframe → host labels.
  3. Range measurement bar showing Δ between two events.
  4. Detail pane with a decoded payload.
  (Capture from the Crosstalk panel on the demo page or a real app, then crop to size.)
- **Small promo tile (optional):** 440×280.

---

## Pre-submission checklist

- [ ] `icons` present in manifest (16/32/48/128) ✓
- [ ] `action.default_icon` set ✓
- [ ] Privacy policy published at a public URL (PRIVACY.md on GitHub `main`)
- [ ] Description, summary, category filled in
- [ ] At least one 1280×800 screenshot
- [ ] Built zip from a clean tree (see store/build.sh) excludes dev files
- [ ] Version bumped in manifest for each upload
- [ ] One-time $5 developer registration paid

---

## How to package & submit

1. Register once at the Chrome Web Store Developer Dashboard
   (https://chrome.google.com/webstore/devconsole) — $5 one-time fee.
2. Build the upload zip:
   ```
   bash store/build.sh
   ```
   → produces `dist/crosstalk-<version>.zip`.
3. In the dashboard: **New item → Upload** the zip.
4. Fill in the listing using the text above; upload icon + screenshots.
5. Answer the privacy/permission questions (text above).
6. Submit for review. Broad-host-permission extensions are often reviewed
   manually and can take several business days.
