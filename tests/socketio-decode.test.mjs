// Golden tests for the engine.io/socket.io decoder — the protocol-parsing core.
// Run with:  node tests/socketio-decode.test.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { decodeSocketIO } = require("../src/inject/socketio-decode.js");

let pass = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok  " + name); }
  catch (e) { console.error("FAIL  " + name + "\n      " + e.message); process.exitCode = 1; }
}

t("EVENT with payload", () => {
  const d = decodeSocketIO('42["result_ready",{"url":"https://x"}]');
  assert.equal(d.engineType, "message");
  assert.equal(d.sioType, "EVENT");
  assert.equal(d.namespace, "/");
  assert.equal(d.eventName, "result_ready");
  assert.deepEqual(d.args, [{ url: "https://x" }]);
  assert.equal(d.decoded, true);
});

t("EVENT with namespace and ack id", () => {
  const d = decodeSocketIO('42/chat,7["message",{"chunk":"x"}]');
  assert.equal(d.namespace, "/chat");
  assert.equal(d.ackId, 7);
  assert.equal(d.eventName, "message");
});

t("ACK frame", () => {
  const d = decodeSocketIO('4312["ok"]');
  assert.equal(d.sioType, "ACK");
  assert.equal(d.ackId, 12);
  assert.deepEqual(d.args, ["ok"]);
});

t("CONNECT to namespace", () => {
  const d = decodeSocketIO('40/chat,{"sid":"abc"}');
  assert.equal(d.sioType, "CONNECT");
  assert.equal(d.namespace, "/chat");
  assert.deepEqual(d.args, { sid: "abc" });
});

t("engine.io open handshake", () => {
  const d = decodeSocketIO('0{"sid":"s1","upgrades":["websocket"],"pingInterval":25000}');
  assert.equal(d.engineType, "open");
  assert.equal(d.data.sid, "s1");
});

t("ping / pong", () => {
  assert.equal(decodeSocketIO("2").engineType, "ping");
  assert.equal(decodeSocketIO("3").engineType, "pong");
});

t("non-string returns null", () => {
  assert.equal(decodeSocketIO(new ArrayBuffer(4)), null);
  assert.equal(decodeSocketIO(""), null);
});

t("malformed payload flagged", () => {
  const d = decodeSocketIO('42["bad",{not json}]');
  assert.equal(d.decoded, false);
  assert.equal(d.parseError, true);
});

console.log("\n" + pass + " passed");
