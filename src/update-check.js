/**
 * update-check.js - Handles checking for and applying service worker updates
 * 
 * This module provides an update check flow that shows a spinner while checking
 * for updates, downloads them if available, and reloads the page when ready.
 */

const UPDATE_CHECK_KEY = "mcr_update_checked";
const UPDATE_TIMEOUT_MS = 15000; // 15 seconds as requested

/**
 * Creates a spinner element for showing update progress
 * @returns {HTMLElement} The spinner div
 */
function createSpinner() {
  const spinner = document.createElement("div");
  spinner.className = "spinner";
  spinner.setAttribute("aria-label", "Checking for updates");
  return spinner;
}

/**
 * Creates a status message element
 * @param {string} message - The message to display
 * @returns {HTMLElement} The message paragraph
 */
function createStatusMessage(message) {
  const p = document.createElement("p");
  p.textContent = message;
  p.style.textAlign = "center";
  p.style.color = "var(--muted)";
  p.style.fontSize = "0.9rem";
  p.style.marginTop = "0.5rem";
  return p;
}

/**
 * Waits for a service worker to reach activated state with a timeout
 * @param {ServiceWorker} worker - The service worker to wait for
 * @param {number} timeoutMs - Maximum time to wait
 * @returns {Promise<boolean>} True if activated, false if timed out
 */
function waitForActivation(worker, timeoutMs) {
  return new Promise((resolve) => {
    // Already activated
    if (worker.state === "activated") {
      resolve(true);
      return;
    }

    let timeoutId;
    const cleanup = () => {
      clearTimeout(timeoutId);
      worker.removeEventListener("statechange", onStateChange);
    };

    const onStateChange = () => {
      if (worker.state === "activated" || worker.state === "redundant") {
        cleanup();
        resolve(worker.state === "activated");
      }
    };

    worker.addEventListener("statechange", onStateChange);
    
    // Set timeout
    timeoutId = setTimeout(() => {
      cleanup();
      resolve(false); // Timed out
    }, timeoutMs);
  });
}

/**
 * Check for service worker updates and reload if found
 * 
 * This function:
 * 1. Shows a spinner in the provided container
 * 2. Checks if an update is available
 * 3. If yes, waits for it to install (with timeout)
 * 4. Reloads the page to activate the new version
 * 5. Uses sessionStorage to prevent infinite reload loops
 * 
 * @param {HTMLElement} containerEl - Element to append the spinner/status to
 * @returns {Promise<void>}
 */
export async function checkForUpdateBeforePin(containerEl) {
  // Check if we just reloaded from an update check
  if (sessionStorage.getItem(UPDATE_CHECK_KEY)) {
    sessionStorage.removeItem(UPDATE_CHECK_KEY);
    return; // Skip check, proceed to PIN entry
  }

  // Skip if offline or no service worker support
  if (!navigator.onLine || !("serviceWorker" in navigator)) {
    return;
  }

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;

  // Create UI elements
  const spinner = createSpinner();
  const statusMessage = createStatusMessage("Checking for updates...");
  containerEl.appendChild(spinner);
  containerEl.appendChild(statusMessage);

  try {
    // Trigger an update check
    await reg.update();
  } catch (error) {
    // Network error or other issue - continue without update
    console.warn("[Update Check] Failed to check for updates:", error);
    spinner.remove();
    statusMessage.remove();
    return;
  }

  // Check if there's a new service worker installing or waiting
  const newWorker = reg.installing || reg.waiting;
  
  if (!newWorker) {
    // No update available - continue to PIN entry
    spinner.remove();
    statusMessage.remove();
    return;
  }

  // Update found! Wait for it to finish installing
  console.log("[Update Check] Update found, waiting for activation...");
  statusMessage.textContent = "Downloading update...";

  const activated = await waitForActivation(newWorker, UPDATE_TIMEOUT_MS);

  if (activated) {
    // Update is ready - reload to activate it
    console.log("[Update Check] Update ready, reloading...");
    statusMessage.textContent = "Update ready, reloading...";
    
    // Set flag to prevent infinite reload loop
    sessionStorage.setItem(UPDATE_CHECK_KEY, "1");
    
    // Small delay so user can see the message
    await new Promise(resolve => setTimeout(resolve, 500));
    
    window.location.reload();
  } else {
    // Timeout - update is still installing in background
    // The sw-reload.js listener will catch it when it finishes
    console.log("[Update Check] Update timed out, continuing with current version");
    statusMessage.textContent = "Update in progress...";
    
    // Clean up after a short delay
    setTimeout(() => {
      spinner.remove();
      statusMessage.remove();
    }, 1000);
  }
}

/**
 * Alternative: Check for updates in the background without blocking PIN entry
 * This is useful if you want to allow the user to enter their PIN immediately
 * while an update check happens in the background
 * 
 * @returns {Promise<boolean>} True if an update was found and will reload
 */
export async function checkForUpdateInBackground() {
  if (!navigator.onLine || !("serviceWorker" in navigator)) {
    return false;
  }

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;

  try {
    await reg.update();
  } catch {
    return false;
  }

  const newWorker = reg.installing || reg.waiting;
  if (!newWorker) return false;

  console.log("[Update Check] Background update found, will reload when ready");
  
  // Wait for activation in the background
  waitForActivation(newWorker, UPDATE_TIMEOUT_MS).then((activated) => {
    if (activated) {
      // Set flag and reload
      sessionStorage.setItem(UPDATE_CHECK_KEY, "1");
      window.location.reload();
    }
  });

  return true;
}
