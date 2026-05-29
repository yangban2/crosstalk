// Crosstalk DevTools panel: connects to the background worker for the inspected
// tab, renders captured events as a single timeline, and offers basic filters.
(function () {
  "use strict";

  // When the extension is reloaded from chrome://extensions, this still-open
  // DevTools panel keeps running against a dead context. Any chrome.* call then
  // throws "Extension context invalidated". We guard every messaging call and,
  // once invalidated, show a banner asking the user to reopen DevTools instead
  // of spamming the console.
  let invalidated = false;

  function isContextAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  function markInvalidated() {
    if (invalidated) return;
    invalidated = true;
    const bar = document.getElementById("toolbar");
    if (bar) {
      const note = document.createElement("span");
      note.textContent = "⚠ Extension reloaded — close & reopen DevTools to reconnect.";
      note.style.color = "#d33";
      note.style.marginLeft = "8px";
      bar.appendChild(note);
    }
  }

  let port = null;
  function connect() {
    if (!isContextAlive()) { markInvalidated(); return; }
    try {
      port = chrome.runtime.connect({ name: "crosstalk-panel" });
      port.onMessage.addListener(onPortMessage);
      port.onDisconnect.addListener(() => { port = null; });
      safePost({ type: "init", tabId: chrome.devtools.inspectedWindow.tabId });
    } catch (_) {
      markInvalidated();
    }
  }

  function safePost(msg) {
    if (!port || !isContextAlive()) { markInvalidated(); return; }
    try { port.postMessage(msg); }
    catch (_) { markInvalidated(); }
  }

  const events = [];
  let t0 = null;
  let paused = false;
  let selectedId = null; // currently open detail row (for toggle behavior)

  const els = {
    rows: document.getElementById("rows"),
    detail: document.getElementById("detail"),
    detailBody: document.getElementById("detail-body"),
    detailClose: document.getElementById("detail-close"),
    detailCopy: document.getElementById("detail-copy"),
    count: document.getElementById("count"),
    pause: document.getElementById("pause"),
    clear: document.getElementById("clear"),
    copy: document.getElementById("copy"),
    fpm: document.getElementById("f-pm"),
    fsock: document.getElementById("f-sock"),
    fnoise: document.getElementById("f-noise"),
    autoscroll: document.getElementById("autoscroll"),
    search: document.getElementById("search"),
    list: document.getElementById("list"),
    measure: document.getElementById("measure"),
    measureText: document.getElementById("measure-text"),
    measureClear: document.getElementById("measure-clear"),
  };

  // Range measurement: anchorId is the first clicked row; a Shift+click sets endId
  // and we report the elapsed time + event count between the two (by timestamp).
  let anchorId = null;
  let endId = null;

  function onPortMessage(m) {
    if (m.type !== "events") return;
    for (const e of m.events) {
      if (t0 == null) t0 = e.t;
      events.push(e);
    }
    if (!paused) render();
  }

  connect();

  function passesFilter(e) {
    if (e.channel === "postMessage" && !els.fpm.checked) return false;
    if (e.channel === "socket" && !els.fsock.checked) return false;
    if (e.noise && els.fnoise.checked) return false;
    const q = els.search.value.trim().toLowerCase();
    if (q) {
      const hay = (e.eventName || "") + " " + (e.raw || "") + " " + safeStr(e.data);
      if (!hay.toLowerCase().includes(q)) return false;
    }
    return true;
  }

  // Short host label for a URL/origin, e.g. "app.example.com" -> "app".
  function shortHost(u) {
    if (!u) return "?";
    try {
      const h = new URL(u).hostname;
      return h.split(".")[0] || h;
    } catch (_) {
      return String(u).slice(0, 16);
    }
  }

  // Is the frame that captured this event the top (host) frame? background fills
  // senderFrameId (0 === top). frameId also carries a "top:"/"frame:" prefix.
  function isTopFrame(e) {
    if (typeof e.senderFrameId === "number") return e.senderFrameId === 0;
    return typeof e.frameId === "string" && e.frameId.startsWith("top:");
  }

  // postMessage direction is per-frame ("in" = this frame received it). To show
  // host↔iframe we combine WHO captured it (top vs sub-frame) with WHERE it came
  // from (origin) / went to (targetOrigin).
  function pmDirLabel(e) {
    const here = isTopFrame(e) ? "host" : "iframe(" + shortHost(e.frameUrl) + ")";
    if (e.dir === "in") {
      const from = e.origin ? shortHost(e.origin) : "?";
      const fromSide = isTopFrame(e)
        ? "iframe(" + from + ")"   // top received → sender is an iframe (or another host)
        : (from === shortHost(e.frameUrl) ? "self" : "host(" + from + ")");
      return fromSide + " → " + here;
    }
    // outbound: captured in the sender frame; target tells the destination origin
    const to = e.targetOrigin && e.targetOrigin !== "*" ? shortHost(e.targetOrigin) : "*";
    return here + " → " + to;
  }

  function dirLabel(e) {
    if (e.channel === "socket") {
      if (e.dir === "out") return "FE → BE";
      if (e.dir === "in") return "BE → FE";
      return e.dir; // open/close
    }
    return pmDirLabel(e);
  }

  function rel(e) {
    const s = (e.t - t0) / 1000;
    return (s === 0 ? "0.000" : "+" + s.toFixed(3)) + "s";
  }

  function safeStr(v) {
    if (v == null) return "";
    try { return typeof v === "string" ? v : JSON.stringify(v); } catch (_) { return String(v); }
  }

  // The "event" column: app event name when known, else the protocol frame kind
  // (ping/pong/open/CONNECT…) so socket control frames are not blank rows.
  function eventLabel(e) {
    if (e.eventName) return e.eventName;
    if (e.channel === "socket" && e.decodedInfo) {
      const i = e.decodedInfo;
      return i.engineType + (i.sioType ? "/" + i.sioType : "");
    }
    return "";
  }

  function summary(e) {
    if (e.channel === "socket" && e.decodedInfo && !e.eventName) {
      return e.decodedInfo.engineType + (e.decodedInfo.sioType ? "/" + e.decodedInfo.sioType : "");
    }
    return safeStr(e.data).slice(0, 200) || safeStr(e.raw).slice(0, 200);
  }

  function render() {
    const visible = events.filter(passesFilter);
    const hiddenNoise = els.fnoise.checked ? events.filter((e) => e.noise).length : 0;
    els.count.textContent =
      visible.length + " / " + events.length + (hiddenNoise ? " (" + hiddenNoise + " noise hidden)" : "");
    const frag = document.createDocumentFragment();
    for (const e of visible) {
      const tr = document.createElement("tr");
      tr.className = e.channel === "socket" ? "sock" : "pm";
      tr.innerHTML =
        "<td>" + rel(e) + "</td>" +
        "<td class='ch'>" + (e.channel === "socket" ? "🔌 socket" : "✉️ postMessage") + (e.sub ? " " + e.sub : "") + "</td>" +
        "<td class='dir'>" + dirLabel(e) + "</td>" +
        "<td>" + esc(eventLabel(e)) + "</td>" +
        "<td class='summary'>" + esc(summary(e)) + "</td>" +
        "<td>" + fmtSize(e.byteSize) + "</td>";
      tr.addEventListener("click", (ev) => {
        if (ev.shiftKey && anchorId && anchorId !== e.id) {
          // Shift+click sets the range end and measures.
          endId = e.id;
          ev.preventDefault();
          window.getSelection && window.getSelection().removeAllRanges();
          render();
          return;
        }
        // Plain click: set the measurement anchor and toggle the detail.
        anchorId = e.id;
        endId = null;
        if (selectedId === e.id) closeDetail();
        else showDetail(e, tr);
        render();
      });
      // Mark range rows.
      if (e.id === anchorId) tr.classList.add("range-start");
      if (e.id === endId) tr.classList.add("range-end");
      frag.appendChild(tr);
    }
    els.rows.replaceChildren(frag);
    markRangeMiddle(visible);
    updateMeasure();
    if (els.autoscroll.checked && !endId) els.list.scrollTop = els.list.scrollHeight;
  }

  function findEvent(id) {
    return id == null ? null : events.find((e) => e.id === id) || null;
  }

  // Shade the rows strictly between start and end (by time order in the visible list).
  function markRangeMiddle(visible) {
    if (!anchorId || !endId) return;
    const a = findEvent(anchorId), b = findEvent(endId);
    if (!a || !b) return;
    const lo = Math.min(a.t, b.t), hi = Math.max(a.t, b.t);
    const trs = els.rows.children;
    visible.forEach((e, i) => {
      if (e.t > lo && e.t < hi && e.id !== anchorId && e.id !== endId) {
        trs[i] && trs[i].classList.add("range-mid");
      }
    });
  }

  function updateMeasure() {
    const a = findEvent(anchorId);
    if (!a) { els.measure.classList.add("hidden"); return; }
    els.measure.classList.remove("hidden");
    const b = findEvent(endId);
    if (!b) {
      els.measureText.textContent =
        "anchor: " + eventLabel(a) + " @ " + new Date(a.t).toISOString().slice(11, 23) +
        "  —  Shift+click another row to measure Δ";
      return;
    }
    const lo = Math.min(a.t, b.t), hi = Math.max(a.t, b.t);
    const elapsed = hi - lo;
    const between = events.filter((e) => e.t >= lo && e.t <= hi).length;
    const first = a.t <= b.t ? a : b;
    const last = a.t <= b.t ? b : a;
    els.measureText.textContent =
      "Δ " + fmtDuration(elapsed) +
      "   ·   " + between + " events" +
      "   ·   " + eventLabel(first) + " → " + eventLabel(last);
  }

  function fmtDuration(ms) {
    if (ms < 1000) return ms.toFixed(1) + " ms";
    if (ms < 60000) return (ms / 1000).toFixed(3) + " s";
    const m = Math.floor(ms / 60000);
    const s = ((ms % 60000) / 1000).toFixed(1);
    return m + "m " + s + "s";
  }

  let selectedEvent = null;

  function showDetail(e, tr) {
    document.querySelectorAll("tr.sel").forEach((x) => x.classList.remove("sel"));
    tr.classList.add("sel");
    els.detail.classList.add("open");
    selectedId = e.id;
    selectedEvent = e;
    const lines = [];
    lines.push("time     " + new Date(e.t).toISOString());
    lines.push("flow     " + dirLabel(e));
    lines.push("captured " + (isTopFrame(e) ? "host (top frame)" : "iframe (sub-frame)"));
    lines.push("frame    " + (e.frameUrl || e.frameId || ""));
    if (e.origin) lines.push("origin   " + e.origin + "   (sender)");
    if (e.targetOrigin) lines.push("target   " + e.targetOrigin + "   (destination)");
    if (e.url) lines.push("url      " + e.url);
    if (e.socketNamespace) lines.push("ns       " + e.socketNamespace);
    if (e.nonce) lines.push("nonce    " + e.nonce);
    els.detailBody.innerHTML =
      "<pre>" + esc(lines.join("\n")) + "</pre>" +
      (e.data !== undefined ? "<b>data</b><pre>" + esc(pretty(e.data)) + "</pre>" : "") +
      (e.raw ? "<b>raw</b><pre>" + esc(e.raw) + "</pre>" : "");
  }

  function closeDetail() {
    els.detail.classList.remove("open");
    document.querySelectorAll("tr.sel").forEach((x) => x.classList.remove("sel"));
    selectedId = null;
    selectedEvent = null;
  }

  function pretty(v) { try { return JSON.stringify(v, null, 2); } catch (_) { return String(v); } }
  function fmtSize(n) {
    if (!n && n !== 0) return "";
    if (n < 1024) return n + "B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + "K";
    return (n / 1024 / 1024).toFixed(1) + "M";
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  els.pause.addEventListener("click", () => {
    paused = !paused;
    els.pause.textContent = paused ? "▶ Resume" : "⏸ Pause";
    if (!paused) render();
  });
  els.clear.addEventListener("click", () => {
    events.length = 0; t0 = null;
    anchorId = null; endId = null;
    closeDetail();
    safePost({ type: "clear" });
    render();
  });
  [els.fpm, els.fsock, els.fnoise, els.search].forEach((el) => el.addEventListener("input", render));

  // ---- copy ----------------------------------------------------------------
  // Copy the currently *visible* (filtered) rows. Each line is a compact
  // human-readable header; the full structured log is appended as JSON so it
  // can be re-parsed or pasted into an issue.
  function copyText(text, btn) {
    const done = (ok) => {
      const orig = btn.textContent;
      btn.textContent = ok ? "✓ Copied" : "✕ Failed";
      setTimeout(() => (btn.textContent = orig), 1200);
    };
    // navigator.clipboard works in the DevTools panel context (focused).
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done(true), () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      done(ok);
    } catch (_) {
      done(false);
    }
  }

  function eventToLine(e) {
    const dir = dirLabel(e);
    const ch = e.channel === "socket" ? "socket" + (e.sub ? "/" + e.sub : "") : "postMessage";
    const body = safeStr(e.data) || e.raw || "";
    return [rel(e), ch, dir, eventLabel(e), body].filter(Boolean).join("\t");
  }

  els.copy.addEventListener("click", () => {
    const visible = events.filter(passesFilter);
    const header = "# Crosstalk log — " + visible.length + " events (" + new Date().toISOString() + ")";
    const lines = visible.map(eventToLine).join("\n");
    const json = JSON.stringify(visible, null, 2);
    copyText(header + "\n\n" + lines + "\n\n# --- JSON ---\n" + json, els.copy);
  });

  els.detailCopy.addEventListener("click", () => {
    if (!selectedEvent) return;
    copyText(JSON.stringify(selectedEvent, null, 2), els.detailCopy);
  });

  // ---- detail close --------------------------------------------------------
  els.detailClose.addEventListener("click", closeDetail);
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (els.detail.classList.contains("open")) closeDetail();
    else clearMeasure();
  });

  // ---- range measurement ---------------------------------------------------
  function clearMeasure() {
    anchorId = null;
    endId = null;
    render();
  }
  els.measureClear.addEventListener("click", clearMeasure);
})();
