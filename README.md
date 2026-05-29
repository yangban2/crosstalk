# Crosstalk

> Observe iframe `postMessage` and Socket.IO/WebSocket traffic in a **single DevTools timeline**.

Chrome's built-in DevTools won't show you `postMessage` traffic at all, and surfaces
WebSocket frames only as raw `42["event",…]` engine.io blobs in the Network tab — with
no way to correlate the two channels in time. Crosstalk patches the page's `postMessage`,
`WebSocket`, and the engine.io polling transport (no app code changes), decodes socket.io
frames into readable events, and puts everything on one filterable timeline.

Built for debugging apps where **host page ↔ iframe ↔ backend socket** all talk at once
(app builders, embedded widgets, sandboxed previews).

> Status: **M0/M1 spike.** Vanilla JS, no build step — load it unpacked and it runs.

## Install (load unpacked)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this repo's root folder.
3. Open any page, open **DevTools**, pick the **Crosstalk** panel.

## Try it

Open `demo/index.html` (e.g. `python3 -m http.server` then visit it), open the Crosstalk
panel, and click the buttons. The host↔iframe `postMessage` round-trips appear immediately;
the WebSocket buttons use a public echo server to exercise socket.io decoding.

## How it works

```
MAIN world   inject.js   patches postMessage / WebSocket / XHR(polling), decodes socket.io
   │ window.postMessage({__CROSSTALK__})
ISOLATED     content.js  relays batches to the background worker
   │ chrome.runtime
background   per-tab ring buffer + routes to the panel for that tab
   │ port
DevTools     panel.js    one timeline: time · channel · direction · event · payload
```

`inject.js` runs in the page's own context (`world: "MAIN"`, `run_at: document_start`) so
it can wrap globals before page scripts use them. It's injected into **all frames**
(`all_frames: true`) so cross-origin iframes are captured too. The "inbound" side of each
message is treated as the source of truth (every message is received by exactly one frame
we've instrumented).

See [DESIGN.md](DESIGN.md) for the full design, edge cases, and roadmap.

## Tests

```
node tests/socketio-decode.test.mjs
```

The engine.io/socket.io decoder is the protocol-parsing core and has golden tests.

## Privacy & permissions

Crosstalk requests `<all_urls>` + `all_frames` — a **broad** permission, needed because an
iframe's origin isn't known in advance. In return:

- **Captured data never leaves your local DevTools.** No external transport, no remote logging.
- Capture is scoped to tabs whose Crosstalk panel is open.

Auth-token masking and export are on the roadmap (see DESIGN.md §9). Review the code before
using it on pages with sensitive data.

## License

MIT — see [LICENSE](LICENSE).
