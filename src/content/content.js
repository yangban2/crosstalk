// ISOLATED-world relay. Receives batched events that inject.js posts on the
// window, and forwards them to the background service worker. background fills
// in tabId / frameId from the message sender.
(function () {
  "use strict";
  const MARKER = "__CROSSTALK__";

  window.addEventListener(
    "message",
    function (e) {
      if (e.source !== window) return;
      const d = e.data;
      if (!(d && typeof d === "object" && d[MARKER] && Array.isArray(d.batch))) return;
      try {
        chrome.runtime.sendMessage({ type: "crosstalk:batch", batch: d.batch });
      } catch (_) {
        // Service worker may be cycling; dropping a batch is acceptable for M0.
      }
    },
    false
  );
})();
