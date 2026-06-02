# Privacy Policy — Crosstalk (Frame & Socket Inspector)

_Last updated: 2026-06-02_

Crosstalk is an open-source Chrome DevTools extension for inspecting cross-frame
`postMessage` and Socket.IO/WebSocket traffic. This policy explains what data the
extension accesses and how it is handled.

## Summary

**Crosstalk does not collect, transmit, sell, or share any user or website data.**
Everything the extension observes is processed locally on your device and shown only
in the Crosstalk DevTools panel.

## What the extension accesses

To do its job, Crosstalk reads the following **website content** on pages where you
have DevTools open:

- `postMessage` events exchanged between frames (iframes) and the parent window
- Socket.IO / WebSocket frames sent and received by the page

This data is displayed in a DevTools panel so you, the developer, can inspect the
source, direction, type, and payload of each message while debugging.

## How the data is handled

- **Processed locally only.** Captured messages live in memory for the lifetime of
  the DevTools session and are rendered in the panel. They are never sent to any
  server or third party.
- **Not stored remotely.** The extension does not write captured page data to any
  remote storage.
- **No transmission.** The extension makes no network requests to send your data
  anywhere.

## Local settings

The extension uses Chrome's `storage` permission solely to remember your local UI
preferences (such as filters, the "hide noise" toggle, and auto-scroll). These
settings stay on your device and contain no personal or website data.

## Permissions

- **Host permissions (`<all_urls>`) / content scripts (`all_frames`)** — required to
  observe `postMessage` and socket traffic on any site a developer may debug,
  including cross-origin iframes. Used only to read messages for local display.
- **`storage`** — used only for local UI preferences.

## Data we do NOT do

- We do not sell or transfer user data to third parties.
- We do not use data for any purpose unrelated to the extension's single purpose.
- We do not use data to determine creditworthiness or for lending purposes.

## Contact

For questions about this policy, contact: **taeyang@enhans.ai**

This extension is open source. You can review the full source code at
<https://github.com/yangban2/crosstalk>.
