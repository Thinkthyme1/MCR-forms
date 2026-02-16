// ============================================================================
// PROPOSED FIX for checkForUpdateBeforePin
// Replace the function in src/main.js starting at line ~349
// ============================================================================

const UPDATE_CHECK_KEY = "mcr_update_checked";
const MAX_UPDATE_WAIT_MS = 30000; // 30 seconds maximum wait

/**
 * Check for a SW update and reload if one is found.
 *
 * Shows a spinner in `containerEl` while checking. Waits for the SW to
 * fully activate before reloading to avoid race conditions. Uses a
 * sessionStorage flag to avoid infinite reload loops.
 *
 * @param {HTMLElement} containerEl — element to append the spinner to
 * @returns {Promise<void>} resolves when the PIN input should be shown
 */
async function checkForUpdateBeforePin(containerEl) {
  // Already checked this page-load (post-reload) — skip.
  if (sessionStorage.getItem(UPDATE_CHECK_KEY)) {
    sessionStorage.removeItem(UPDATE_CHECK_KEY);
    return;
  }

  if (!navigator.onLine || !("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;

  // Show spinner while we talk to the network
  const spinner = document.createElement("div");
  spinner.className = "spinner";
  containerEl.appendChild(spinner);

  try {
    await reg.update();
  } catch {
    spinner.remove();
    return;
  }

  const pending = reg.installing || reg.waiting;
  if (!pending) { 
    spinner.remove(); 
    return; 
  }

  /* Wait for the new SW to activate, with a maximum timeout of 30s.
     Show the spinner the entire time so users know something is happening.
     If it times out, show an error and let them proceed. */
  const startTime = Date.now();
  const activated = await new Promise((resolve) => {
    // Check if already activated
    if (pending.state === "activated") { 
      resolve(true); 
      return; 
    }

    const onStateChange = () => {
      if (pending.state === "activated" || pending.state === "redundant") {
        pending.removeEventListener("statechange", onStateChange);
        clearTimeout(timeoutId);
        resolve(true);
      }
    };
    
    pending.addEventListener("statechange", onStateChange);
    
    const timeoutId = setTimeout(() => {
      pending.removeEventListener("statechange", onStateChange);
      resolve(false);
    }, MAX_UPDATE_WAIT_MS);
  });

  spinner.remove();

  const elapsedMs = Date.now() - startTime;
  console.log(`[Update Check] SW activation took ${elapsedMs}ms, activated: ${activated}`);

  if (!activated) {
    // Timeout - give user option to proceed or try hard refresh
    const proceed = confirm(
      "Update is taking longer than expected. Would you like to proceed anyway?\n\n" +
      "Click OK to continue (update will finish in background)\n" +
      "Click Cancel to try reloading the page"
    );
    
    if (!proceed) {
      window.location.reload();
      return;
    }
    
    // Let them proceed, but sw-reload.js will catch controllerchange
    showToast("Update downloading in background. App may reload automatically.");
    return;
  }

  // SW is activated - safe to reload now
  sessionStorage.setItem(UPDATE_CHECK_KEY, "1");
  window.location.reload();
}

// ============================================================================
// ALTERNATIVE: More Conservative Approach
// Only checks for updates if not checked recently
// ============================================================================

const UPDATE_CHECK_KEY_ALT = "mcr_update_checked";
const LAST_UPDATE_CHECK_TIME = "mcr_last_update_check";
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_UPDATE_WAIT_MS_ALT = 15000; // 15 seconds

async function checkForUpdateBeforePinConservative(containerEl) {
  // Already checked this page-load (post-reload) — skip.
  if (sessionStorage.getItem(UPDATE_CHECK_KEY_ALT)) {
    sessionStorage.removeItem(UPDATE_CHECK_KEY_ALT);
    return;
  }

  if (!navigator.onLine || !("serviceWorker" in navigator)) return;

  // Skip if we checked recently (within last 5 minutes)
  const lastCheckStr = sessionStorage.getItem(LAST_UPDATE_CHECK_TIME);
  if (lastCheckStr) {
    const lastCheck = parseInt(lastCheckStr);
    const elapsed = Date.now() - lastCheck;
    if (elapsed < UPDATE_CHECK_INTERVAL_MS) {
      console.log(`[Update Check] Skipping - last check was ${Math.round(elapsed/1000)}s ago`);
      return;
    }
  }

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;

  // Show spinner while we talk to the network
  const spinner = document.createElement("div");
  spinner.className = "spinner";
  containerEl.appendChild(spinner);

  try {
    await reg.update();
  } catch {
    spinner.remove();
    sessionStorage.setItem(LAST_UPDATE_CHECK_TIME, Date.now().toString());
    return;
  }

  const pending = reg.installing || reg.waiting;
  if (!pending) { 
    spinner.remove();
    sessionStorage.setItem(LAST_UPDATE_CHECK_TIME, Date.now().toString());
    return; 
  }

  /* Wait for activation with a reasonable timeout of 15s.
     If it times out, let the update finish in background. */
  const activated = await new Promise((resolve) => {
    if (pending.state === "activated") { 
      resolve(true); 
      return; 
    }

    const onStateChange = () => {
      if (pending.state === "activated" || pending.state === "redundant") {
        pending.removeEventListener("statechange", onStateChange);
        clearTimeout(timeoutId);
        resolve(true);
      }
    };
    
    pending.addEventListener("statechange", onStateChange);
    
    const timeoutId = setTimeout(() => {
      pending.removeEventListener("statechange", onStateChange);
      resolve(false);
    }, MAX_UPDATE_WAIT_MS_ALT);
  });

  spinner.remove();

  if (activated) {
    // Update is ready - reload immediately
    sessionStorage.setItem(UPDATE_CHECK_KEY_ALT, "1");
    sessionStorage.setItem(LAST_UPDATE_CHECK_TIME, Date.now().toString());
    window.location.reload();
  } else {
    // Install is taking too long - let it finish in background
    // sw-reload.js will catch controllerchange and reload automatically
    showToast("Update downloading in background...");
    sessionStorage.setItem(LAST_UPDATE_CHECK_TIME, Date.now().toString());
    // Don't block the user - let them enter their PIN
  }
}

// ============================================================================
// DEBUGGING VERSION
// Add extensive logging to understand what's happening
// ============================================================================

async function checkForUpdateBeforePinDebug(containerEl) {
  console.log('[Update Check] Starting...');
  
  if (sessionStorage.getItem(UPDATE_CHECK_KEY)) {
    console.log('[Update Check] Already checked this page load - skipping');
    sessionStorage.removeItem(UPDATE_CHECK_KEY);
    return;
  }

  if (!navigator.onLine) {
    console.log('[Update Check] Offline - skipping');
    return;
  }

  if (!("serviceWorker" in navigator)) {
    console.log('[Update Check] Service Worker not supported - skipping');
    return;
  }

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    console.log('[Update Check] No SW registration found - skipping');
    return;
  }

  console.log('[Update Check] SW registration found:', {
    installing: !!reg.installing,
    waiting: !!reg.waiting,
    active: !!reg.active
  });

  const spinner = document.createElement("div");
  spinner.className = "spinner";
  containerEl.appendChild(spinner);
  console.log('[Update Check] Spinner added, calling reg.update()...');

  const updateStartTime = Date.now();
  try {
    await reg.update();
    console.log(`[Update Check] reg.update() completed in ${Date.now() - updateStartTime}ms`);
  } catch (err) {
    console.error('[Update Check] reg.update() failed:', err);
    spinner.remove();
    return;
  }

  const pending = reg.installing || reg.waiting;
  console.log('[Update Check] After update():', {
    installing: !!reg.installing,
    waiting: !!reg.waiting,
    active: !!reg.active,
    pendingState: pending?.state
  });

  if (!pending) { 
    console.log('[Update Check] No update found - removing spinner');
    spinner.remove(); 
    return; 
  }

  console.log(`[Update Check] Update found! Waiting for activation... (current state: ${pending.state})`);
  const activationStartTime = Date.now();

  const activated = await new Promise((resolve) => {
    if (pending.state === "activated") { 
      console.log('[Update Check] Already activated!');
      resolve(true); 
      return; 
    }

    const onStateChange = () => {
      console.log(`[Update Check] State changed to: ${pending.state}`);
      if (pending.state === "activated" || pending.state === "redundant") {
        pending.removeEventListener("statechange", onStateChange);
        clearTimeout(timeoutId);
        resolve(true);
      }
    };
    
    pending.addEventListener("statechange", onStateChange);
    
    const timeoutId = setTimeout(() => {
      console.warn(`[Update Check] Timeout after 15s (state: ${pending.state})`);
      pending.removeEventListener("statechange", onStateChange);
      resolve(false);
    }, 15000);
  });

  const activationElapsed = Date.now() - activationStartTime;
  console.log(`[Update Check] Activation ${activated ? 'completed' : 'timed out'} in ${activationElapsed}ms`);

  spinner.remove();

  if (activated) {
    console.log('[Update Check] Reloading page...');
    sessionStorage.setItem(UPDATE_CHECK_KEY, "1");
    window.location.reload();
  } else {
    console.warn('[Update Check] Timeout - letting update finish in background');
    showToast("Update downloading in background...");
  }
}
