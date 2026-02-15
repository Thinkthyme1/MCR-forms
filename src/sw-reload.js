/* Non-module script — executes synchronously during HTML parsing, before
   deferred ES modules.  Eliminates the race where a navigation-triggered
   SW update completes before the module-scope code in main.js runs.

   Only reloads on UPDATE (controller already exists), not on first-ever
   SW install — on first visit the page was loaded from the network so
   it already has the latest content. */
(function () {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;
  var reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
})();
