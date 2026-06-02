// Runs before first paint to set the theme and avoid a flash of the wrong mode.
// Kept as an external file (not inline) so the page can ship a strict
// Content-Security-Policy with script-src 'self' — no 'unsafe-inline'.
(function () {
  try {
    var raw = localStorage.getItem("bt_theme");
    var dark =
      raw === "dark" ||
      (!raw &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#14110a" : "#f5efe3");
  } catch (_) {}
})();
