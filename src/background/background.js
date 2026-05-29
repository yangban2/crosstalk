// Service worker: routes captured events from content scripts to the DevTools
// panel for the matching tab. Keeps a short per-tab ring buffer so a panel that
// opens slightly late still sees recent traffic.
const RING_MAX = 2000;
const rings = new Map(); // tabId -> CapturedEvent[]
const ports = new Map(); // tabId -> Port (devtools panel)

function ring(tabId) {
  let r = rings.get(tabId);
  if (!r) { r = []; rings.set(tabId, r); }
  return r;
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "crosstalk:batch" || !sender.tab) return;
  const tabId = sender.tab.id;
  const frameId = sender.frameId;
  const enriched = msg.batch.map((e) => ({ ...e, tabId, senderFrameId: frameId }));

  const r = ring(tabId);
  for (const e of enriched) {
    r.push(e);
    if (r.length > RING_MAX) r.shift();
  }

  const port = ports.get(tabId);
  if (port) {
    try { port.postMessage({ type: "events", events: enriched }); } catch (_) { /* panel closing */ }
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "crosstalk-panel") return;
  let tabId = null;
  port.onMessage.addListener((m) => {
    if (m && m.type === "init" && typeof m.tabId === "number") {
      tabId = m.tabId;
      ports.set(tabId, port);
      // Replay buffered history so the panel is not empty on open.
      const r = rings.get(tabId);
      if (r && r.length) port.postMessage({ type: "events", events: r.slice() });
    } else if (m && m.type === "clear" && tabId != null) {
      rings.set(tabId, []);
    }
  });
  port.onDisconnect.addListener(() => {
    if (tabId != null && ports.get(tabId) === port) ports.delete(tabId);
  });
});

// Drop a tab's buffer when it navigates away or closes.
chrome.tabs.onRemoved.addListener((tabId) => { rings.delete(tabId); ports.delete(tabId); });
