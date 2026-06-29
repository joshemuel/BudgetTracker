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
    // Skin (editorial/pastel) defaults to editorial — the product default.
    var pastel = localStorage.getItem("bt_skin") === "pastel";
    document.documentElement.dataset.skin = pastel ? "pastel" : "editorial";
    var meta = document.querySelector('meta[name="theme-color"]');
    var color = pastel
      ? dark
        ? "#11141b"
        : "#f5f6fb"
      : dark
        ? "#1b1813"
        : "#f5efe3";
    if (meta) meta.setAttribute("content", color);
  } catch (_) {}
})();
