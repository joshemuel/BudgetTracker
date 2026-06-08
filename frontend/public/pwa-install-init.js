// Runs before React mounts so the browser's install signals are never missed.
// Chrome can fire `beforeinstallprompt` during initial page load — before the
// React app hydrates and attaches its own listener — and the event is then lost
// forever. We capture it here, stash it on `window`, and re-broadcast it as a
// custom event the usePwaInstall hook can pick up whether it mounts before or
// after the native event fires.
//
// Kept as an external file (not inline) so the page can ship a strict
// Content-Security-Policy with script-src 'self' — matching theme-init.js.
(function () {
  try {
    window.addEventListener("beforeinstallprompt", function (event) {
      // Stop Chrome's automatic mini-infobar; we surface our own Install button.
      event.preventDefault();
      window.__btInstallPrompt = event;
      window.dispatchEvent(new CustomEvent("bt:install-available"));
    });

    window.addEventListener("appinstalled", function () {
      window.__btInstalled = true;
      window.__btInstallPrompt = null;
      window.dispatchEvent(new CustomEvent("bt:installed"));
    });
  } catch (_) {}
})();
