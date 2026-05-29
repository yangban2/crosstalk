// MAIN-world patcher. Runs in the page's own JS context (manifest world: "MAIN",
// run_at: document_start) so it can wrap the page's global WebSocket / postMessage /
// XHR *before* page scripts use them.
//
// Captured events are relayed to the ISOLATED-world content script via
// window.postMessage with a private marker. content.js forwards them to the
// background service worker.
(function () {
  "use strict";

  const MARKER = "__CROSSTALK__";
  const SIO_URL = /\/socket\.io\/.*[?&](?:EIO|transport)=/i;

  // Stable-ish id for this frame within the tab.
  const FRAME_ID =
    (window === window.top ? "top" : "frame") + ":" + hash(location.href);

  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function now() {
    return performance.timeOrigin + performance.now();
  }

  // ---- relay (batched) -----------------------------------------------------
  let queue = [];
  let scheduled = false;
  function emit(evt) {
    evt.id = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random());
    evt.t = now();
    evt.frameId = FRAME_ID;
    evt.frameUrl = location.href;
    queue.push(evt);
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 50);
    }
  }
  function flush() {
    scheduled = false;
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    // The relay itself uses postMessage; the marker keeps it out of capture.
    origPostMessage.call(window, { [MARKER]: true, batch }, "*");
  }

  function safeClone(value) {
    try {
      return { data: structuredClone(value), size: roughSize(value) };
    } catch (_) {
      try {
        const json = JSON.stringify(value, serializer());
        return { data: json === undefined ? String(value) : JSON.parse(json), size: json ? json.length : 0 };
      } catch (_) {
        return { data: String(value), size: 0 };
      }
    }
  }
  function serializer() {
    const seen = new WeakSet();
    return function (k, v) {
      if (typeof v === "function") return "[Function]";
      if (v instanceof Node) return "[DOM " + v.nodeName + "]";
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[Circular]";
        seen.add(v);
      }
      return v;
    };
  }
  function roughSize(v) {
    try { return JSON.stringify(v).length; } catch (_) { return 0; }
  }

  // ---- postMessage ---------------------------------------------------------
  const origPostMessage = window.postMessage;

  // Dev tooling and browser-extension chatter floods the message channel with
  // traffic that has nothing to do with the app. We tag (not drop) it as noise
  // so the panel can hide it by default but still reveal it on demand.
  const NOISE_SOURCES = /^(react-devtools|react-devtools-bridge|react-devtools-content-script|@devtools|redux-devtools|vue-devtools|webpackHotUpdate|webpack|metamask|__REACT)/i;

  function isNoise(d) {
    if (!d || typeof d !== "object") return false;
    if (typeof d.source === "string" && NOISE_SOURCES.test(d.source)) return true;
    // React DevTools also uses a bare {source:"react-devtools-*"} shape handled
    // above; webpack HMR sends {type:"webpack...",...}.
    if (typeof d.type === "string" && /^webpack/i.test(d.type)) return true;
    return false;
  }

  window.postMessage = function (message, targetOrigin, transfer) {
    // Never capture or recurse on our own relay frames.
    if (!(message && typeof message === "object" && message[MARKER])) {
      const c = safeClone(message);
      emit({
        channel: "postMessage",
        dir: "out",
        targetOrigin: typeof targetOrigin === "string" ? targetOrigin : undefined,
        eventName: message && typeof message === "object" ? message.type : undefined,
        nonce: message && typeof message === "object" ? message.nonce : undefined,
        data: c.data,
        byteSize: c.size,
        noise: isNoise(message),
        decoded: true,
      });
    }
    return origPostMessage.apply(this, arguments);
  };

  window.addEventListener(
    "message",
    function (e) {
      const d = e.data;
      if (d && typeof d === "object" && d[MARKER]) return; // our relay
      const c = safeClone(d);
      emit({
        channel: "postMessage",
        dir: "in",
        origin: e.origin,
        eventName: d && typeof d === "object" ? d.type : undefined,
        nonce: d && typeof d === "object" ? d.nonce : undefined,
        data: c.data,
        byteSize: c.size,
        noise: isNoise(d),
        decoded: true,
      });
    },
    true // capture phase: observe before page handlers
  );

  // ---- WebSocket -----------------------------------------------------------
  const OrigWS = window.WebSocket;
  if (OrigWS) {
    function PatchedWS(url, protocols) {
      const ws = protocols !== undefined ? new OrigWS(url, protocols) : new OrigWS(url);
      const isSio = SIO_URL.test(String(url));
      emit({ channel: "socket", sub: "ws", dir: "open", url: String(url), decoded: true });

      const origSend = ws.send;
      ws.send = function (payload) {
        recordSocketFrame("out", payload, isSio);
        return origSend.apply(ws, arguments);
      };
      ws.addEventListener("message", function (ev) {
        recordSocketFrame("in", ev.data, isSio);
      });
      ws.addEventListener("close", function () {
        emit({ channel: "socket", sub: "ws", dir: "close", url: String(url), decoded: true });
      });
      return ws;
    }
    PatchedWS.prototype = OrigWS.prototype;
    PatchedWS.CONNECTING = OrigWS.CONNECTING;
    PatchedWS.OPEN = OrigWS.OPEN;
    PatchedWS.CLOSING = OrigWS.CLOSING;
    PatchedWS.CLOSED = OrigWS.CLOSED;
    window.WebSocket = PatchedWS;
  }

  // engine.io heartbeat and no-op frames carry no app meaning — tag as noise.
  const NOISE_ENGINE = { ping: true, pong: true, noop: true };

  function recordSocketFrame(dir, payload, isSio) {
    const raw = typeof payload === "string" ? payload : "[binary " + (payload && payload.byteLength) + "B]";
    const decoded = typeof payload === "string" ? decodeSocketIO(payload) : null;
    emit({
      channel: "socket",
      sub: "ws",
      dir: dir,
      raw: raw,
      socketNamespace: decoded ? decoded.namespace : undefined,
      socketAck: decoded ? decoded.ackId : undefined,
      eventName: decoded ? decoded.eventName : undefined,
      data: decoded ? (decoded.args !== undefined ? decoded.args : decoded.data) : undefined,
      decodedInfo: decoded || undefined,
      decoded: !!(decoded && decoded.decoded),
      noise: !!(decoded && NOISE_ENGINE[decoded.engineType]),
      byteSize: raw.length,
    });
  }

  // ---- XHR (engine.io polling transport) -----------------------------------
  const OrigXHR = window.XMLHttpRequest;
  if (OrigXHR) {
    const open = OrigXHR.prototype.open;
    const send = OrigXHR.prototype.send;
    OrigXHR.prototype.open = function (method, url) {
      this.__crosstalk = { method: method, url: String(url), isSio: SIO_URL.test(String(url)) };
      return open.apply(this, arguments);
    };
    OrigXHR.prototype.send = function (body) {
      const meta = this.__crosstalk;
      if (meta && meta.isSio) {
        if (body != null && typeof body === "string" && body.length) {
          emit({ channel: "socket", sub: "polling", dir: "out", raw: body, decoded: !!decodeSocketIO(body), decodedInfo: decodeSocketIO(body) || undefined, byteSize: body.length, url: meta.url });
        }
        this.addEventListener("load", function () {
          const text = typeof this.responseText === "string" ? this.responseText : "";
          // A polling response may contain multiple frames separated by record sep.
          splitEngineFrames(text).forEach(function (frame) {
            const dec = decodeSocketIO(frame);
            emit({ channel: "socket", sub: "polling", dir: "in", raw: frame, eventName: dec ? dec.eventName : undefined, socketNamespace: dec ? dec.namespace : undefined, data: dec ? (dec.args !== undefined ? dec.args : dec.data) : undefined, decodedInfo: dec || undefined, decoded: !!(dec && dec.decoded), byteSize: frame.length, url: meta.url });
          });
        });
      }
      return send.apply(this, arguments);
    };
  }

  // engine.io v4 batches frames in a polling body separated by \x1e (record separator).
  function splitEngineFrames(text) {
    if (!text) return [];
    return text.split("\x1e").filter(function (s) { return s.length; });
  }
})();
