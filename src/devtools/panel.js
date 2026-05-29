// Crosstalk DevTools panel: connects to the background worker for the inspected
// tab, renders captured events as a single timeline, and offers basic filters.
(function () {
  "use strict";

  const port = chrome.runtime.connect({ name: "crosstalk-panel" });
  port.postMessage({ type: "init", tabId: chrome.devtools.inspectedWindow.tabId });

  const events = [];
  let t0 = null;
  let paused = false;

  const els = {
    rows: document.getElementById("rows"),
    detail: document.getElementById("detail"),
    count: document.getElementById("count"),
    pause: document.getElementById("pause"),
    clear: document.getElementById("clear"),
    fpm: document.getElementById("f-pm"),
    fsock: document.getElementById("f-sock"),
    autoscroll: document.getElementById("autoscroll"),
    search: document.getElementById("search"),
    list: document.getElementById("list"),
  };

  port.onMessage.addListener((m) => {
    if (m.type !== "events") return;
    for (const e of m.events) {
      if (t0 == null) t0 = e.t;
      events.push(e);
    }
    if (!paused) render();
  });

  function passesFilter(e) {
    if (e.channel === "postMessage" && !els.fpm.checked) return false;
    if (e.channel === "socket" && !els.fsock.checked) return false;
    const q = els.search.value.trim().toLowerCase();
    if (q) {
      const hay = (e.eventName || "") + " " + (e.raw || "") + " " + safeStr(e.data);
      if (!hay.toLowerCase().includes(q)) return false;
    }
    return true;
  }

  function dirLabel(e) {
    if (e.channel === "socket") {
      if (e.dir === "out") return "▲ FE→BE";
      if (e.dir === "in") return "▼ BE→FE";
      return "• " + e.dir; // open/close
    }
    return e.dir === "out" ? "▶ out" : "◀ in";
  }

  function rel(e) {
    const s = (e.t - t0) / 1000;
    return (s === 0 ? "0.000" : "+" + s.toFixed(3)) + "s";
  }

  function safeStr(v) {
    if (v == null) return "";
    try { return typeof v === "string" ? v : JSON.stringify(v); } catch (_) { return String(v); }
  }

  function summary(e) {
    if (e.channel === "socket" && e.decodedInfo && !e.eventName) {
      return e.decodedInfo.engineType + (e.decodedInfo.sioType ? "/" + e.decodedInfo.sioType : "");
    }
    return safeStr(e.data).slice(0, 200) || safeStr(e.raw).slice(0, 200);
  }

  function render() {
    const visible = events.filter(passesFilter);
    els.count.textContent = visible.length + " / " + events.length;
    const frag = document.createDocumentFragment();
    for (const e of visible) {
      const tr = document.createElement("tr");
      tr.className = e.channel === "socket" ? "sock" : "pm";
      tr.innerHTML =
        "<td>" + rel(e) + "</td>" +
        "<td class='ch'>" + (e.channel === "socket" ? "🔌" : "✉️") + (e.sub ? " " + e.sub : "") + "</td>" +
        "<td class='dir'>" + dirLabel(e) + "</td>" +
        "<td>" + esc(e.eventName || "") + "</td>" +
        "<td class='summary'>" + esc(summary(e)) + "</td>" +
        "<td>" + fmtSize(e.byteSize) + "</td>";
      tr.addEventListener("click", () => showDetail(e, tr));
      frag.appendChild(tr);
    }
    els.rows.replaceChildren(frag);
    if (els.autoscroll.checked) els.list.scrollTop = els.list.scrollHeight;
  }

  function showDetail(e, tr) {
    document.querySelectorAll("tr.sel").forEach((x) => x.classList.remove("sel"));
    tr.classList.add("sel");
    els.detail.classList.add("open");
    const lines = [];
    lines.push("time     " + new Date(e.t).toISOString());
    lines.push("frame    " + (e.frameUrl || e.frameId || ""));
    if (e.origin) lines.push("origin   " + e.origin);
    if (e.targetOrigin) lines.push("target   " + e.targetOrigin);
    if (e.url) lines.push("url      " + e.url);
    if (e.socketNamespace) lines.push("ns       " + e.socketNamespace);
    if (e.nonce) lines.push("nonce    " + e.nonce);
    els.detail.innerHTML =
      "<pre>" + esc(lines.join("\n")) + "</pre>" +
      (e.data !== undefined ? "<b>data</b><pre>" + esc(pretty(e.data)) + "</pre>" : "") +
      (e.raw ? "<b>raw</b><pre>" + esc(e.raw) + "</pre>" : "");
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
    port.postMessage({ type: "clear" });
    render();
  });
  [els.fpm, els.fsock, els.search].forEach((el) => el.addEventListener("input", render));
})();
