/* Non-module script — executes synchronously during HTML parsing, before
   deferred ES modules.  Eliminates the race where a navigation-triggered
   SW update completes before the module-scope code in main.js runs.

   Only reloads on UPDATE (controller already exists), not on first-ever
   SW install — on first visit the page was loaded from the network so
   it already has the latest content.

   If the user is mid-session (past the PIN screen), we defer the reload
   and let main.js show a toast instead.  main.js sets
   window.__mcrSessionActive = true once the user unlocks. */
(function () {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;
  var reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (reloading) return;
    if (window.__mcrSessionActive) {
      // User is working — don't yank the page out from under them.
      // Stash a flag so main.js can reload at the next safe moment.
      window.__mcrUpdateReady = true;
      return;
    }
    reloading = true;
    location.reload();
  });
})();
