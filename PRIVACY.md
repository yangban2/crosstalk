# Privacy Policy — Crosstalk

_Last updated: 2026-05-29_

Crosstalk is a Chrome DevTools extension for inspecting `postMessage` and
Socket.IO/WebSocket traffic locally, during development.

## Summary

**Crosstalk does not collect, transmit, sell, or share any data.** Everything it
observes stays on your own machine, inside your own browser's DevTools.

## What Crosstalk accesses

To do its job, Crosstalk reads, in the browser tab you are inspecting:

- `postMessage` messages sent and received by the page and its iframes.
- WebSocket frames and engine.io polling traffic (to decode Socket.IO events).

This may include any data your application happens to send over those channels,
which can contain sensitive values (for example auth tokens or user content),
depending on the app you are inspecting.

## How that data is handled

- **Local only.** Captured events are held in memory and shown in the Crosstalk
  DevTools panel for the inspected tab. They are not written to disk by the
  extension, except when *you* explicitly use the "Copy" action to place data on
  your own clipboard.
- **No network transmission.** Crosstalk contains no analytics, telemetry, remote
  logging, or external servers. It never sends captured data anywhere.
- **No third parties.** No data is shared with or sold to anyone.
- **Ephemeral.** Captured events are discarded when you close the DevTools panel,
  clear the log, or close the tab.

## Permissions and why they are needed

- `<all_urls>` + `all_frames`: Crosstalk must run in any page and any iframe
  because an iframe's origin is not known in advance, and cross-origin iframe
  traffic can only be observed from inside that frame. The permission is broad,
  but it is used solely to read the in-page messaging described above — never to
  exfiltrate it.
- `storage`: used only for local extension state (e.g. UI preferences). No
  captured traffic is persisted.

## Your control

- Capture is surfaced only while the Crosstalk DevTools panel is open.
- You can pause, clear, and (only on demand) copy captured data.
- Because the extension is open source (MIT), you can audit exactly what it does:
  https://github.com/yangban2/crosstalk

## Contact

For questions about this policy, open an issue at
https://github.com/yangban2/crosstalk/issues.
