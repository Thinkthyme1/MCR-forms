// sw-reload.js - Handle service worker updates
// This listener fires when a new service worker takes control

const UPDATE_CHECK_KEY = "update_in_progress";
const RETURN_TO_LOCK_KEY = "return_to_lock_after_update";

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.log('[sw-reload] New service worker activated');
    
    // Check if we're in the middle of an intentional update check
    const updateInProgress = sessionStorage.getItem(UPDATE_CHECK_KEY);
    const returnToLock = sessionStorage.getItem(RETURN_TO_LOCK_KEY);
    
    if (updateInProgress === "1") {
      console.log('[sw-reload] Update was intentional, reloading...');
      // Don't clear the flags - let the app handle them after reload
      window.location.reload();
    } else if (returnToLock === "1") {
      console.log('[sw-reload] Returning to lock screen after update');
      window.location.reload();
    } else {
      console.log('[sw-reload] Unexpected service worker change, reloading...');
      // Unintentional update - just reload
      window.location.reload();
    }
  });
}
