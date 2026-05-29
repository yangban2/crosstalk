// engine.io / socket.io v4 frame decoder.
// Pure function: turns a raw text frame like  42/chat,12["message",{...}]
// into a structured object. Event names and namespaces are whatever the app
// defines; this decoder reads them generically and never assumes specific values.
// Returns null when the input is not a string frame.
//
// Dual-use: declared as a global for the MAIN-world content script, and exported
// via module.exports for the Node test (tests/socketio-decode.test.mjs).

function decodeSocketIO(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;

  const ENGINE = { "0": "open", "1": "close", "2": "ping", "3": "pong", "4": "message", "5": "upgrade", "6": "noop" };
  const SIO = { "0": "CONNECT", "1": "DISCONNECT", "2": "EVENT", "3": "ACK", "4": "CONNECT_ERROR", "5": "BINARY_EVENT", "6": "BINARY_ACK" };

  const engineCode = raw[0];
  const out = { engineType: ENGINE[engineCode] || engineCode, decoded: true };

  // Non-message engine.io packets (open/close/ping/pong/upgrade/noop).
  if (engineCode !== "4") {
    if (engineCode === "0") {
      try { out.data = JSON.parse(raw.slice(1)); } catch (_) { /* handshake without json */ }
    }
    return out;
  }

  // engine.io "message" wraps a socket.io packet.
  let rest = raw.slice(1);
  const sioCode = rest[0];
  out.sioType = SIO[sioCode] || sioCode;
  rest = rest.slice(1);

  // Optional namespace: "/name," (defaults to "/").
  let namespace = "/";
  if (rest[0] === "/") {
    const comma = rest.indexOf(",");
    if (comma !== -1) { namespace = rest.slice(0, comma); rest = rest.slice(comma + 1); }
    else { namespace = rest; rest = ""; }
  }
  out.namespace = namespace;

  // Optional ack id (leading digits).
  const ack = rest.match(/^(\d+)/);
  if (ack) { out.ackId = Number(ack[1]); rest = rest.slice(ack[1].length); }

  // Remaining is the JSON payload.
  if (rest.length) {
    try {
      const parsed = JSON.parse(rest);
      if (Array.isArray(parsed) && (out.sioType === "EVENT" || out.sioType === "BINARY_EVENT")) {
        out.eventName = parsed[0];
        out.args = parsed.slice(1);
      } else {
        out.args = parsed;
      }
    } catch (_) {
      out.decoded = false;
      out.parseError = true;
    }
  }
  return out;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { decodeSocketIO };
}
