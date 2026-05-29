// Registers the "Crosstalk" DevTools panel for the inspected tab.
chrome.devtools.panels.create(
  "Crosstalk",
  null,
  "panel.html",
  function () { /* panel created */ }
);
