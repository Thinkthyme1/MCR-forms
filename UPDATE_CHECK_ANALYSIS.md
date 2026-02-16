# Update Check Issue Analysis

## Problem Summary
When clicking the continue button on the lock/reauth screen, the update check takes 15s but doesn't apply updates. After a hard refresh, the updates are visible (Staf→Staff, version increment).

## Root Cause Analysis

### Issue #1: The 5-Second Timeout is Too Short
**Location:** `src/main.js:377-388`

```javascript
await new Promise((resolve) => {
  if (pending.state === "activated") { resolve(); return; }
  const onStateChange = () => {
    if (pending.state === "activated" || pending.state === "redundant") {
      pending.removeEventListener("statechange", onStateChange);
      resolve();
    }
  };
  pending.addEventListener("statechange", onStateChange);
  setTimeout(resolve, 5000);  // ⚠️ TOO SHORT!
});
```

**The Problem:**
- The comment says "With parallel fetches in the install handler this is usually <2s"
- But you're experiencing **15 seconds** of waiting
- The 5-second timeout expires, so the code continues...
- BUT the service worker is still installing in the background!
- The code then reloads the page **before the SW finishes installing**
- On reload, the old SW is still active, so you see the old content

### Issue #2: Race Condition on Reload
**Location:** `src/main.js:393-395`

```javascript
// Update is either applied or in-flight — reload either way.
sessionStorage.setItem(UPDATE_CHECK_KEY, "1");
window.location.reload();
```

**The Problem:**
- If the SW hasn't finished installing when `window.location.reload()` is called, the reload will use the **old** service worker
- The new SW continues installing in the background
- The `sw-reload.js` script *should* catch this with the `controllerchange` event, but...

### Issue #3: sw-reload.js May Not Fire During Reauth
**Location:** `src/sw-reload.js:7-13`

```javascript
if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;
var reloading = false;
navigator.serviceWorker.addEventListener("controllerchange", function () {
  if (reloading) return;
  reloading = true;
  location.reload();
});
```

**The Problem:**
- This only runs during initial page load (it's a non-module synchronous script)
- If the SW update completes **after** the first reload triggered by `checkForUpdateBeforePin`, the `controllerchange` listener may already be set up
- BUT: The sessionStorage flag `UPDATE_CHECK_KEY` is still set to "1"!
- So on the second reload (triggered by sw-reload.js), `checkForUpdateBeforePin` sees the flag and immediately exits
- The user sees the updated content, but it took TWO reloads instead of the expected flow

### Issue #4: Premature Timeout Resolution
**Location:** `src/main.js:377-388`

The current logic is:
1. Wait for SW to activate (or 5s timeout)
2. Reload immediately

But if the timeout fires first (which it does at 5s when install takes 15s), you reload with the old SW still active.

## Why Hard Refresh Works
A hard refresh (Ctrl+Shift+R or Cmd+Shift+R):
1. Bypasses the service worker entirely
2. Fetches fresh content from the network
3. The browser then installs and activates the new SW with the new content
4. No timing race condition

## Proposed Solutions

### Solution A: Increase Timeout (Quick Fix)
Change the timeout from 5s to 20s to account for slow networks/installs:

```javascript
setTimeout(resolve, 20000);  // Increased from 5000
```

**Pros:** Simple one-line fix
**Cons:** Still not foolproof; just pushes the problem further out

### Solution B: Wait for Activation Properly (Better Fix)
Don't reload until the SW is actually activated:

```javascript
async function checkForUpdateBeforePin(containerEl) {
  if (sessionStorage.getItem(UPDATE_CHECK_KEY)) {
    sessionStorage.removeItem(UPDATE_CHECK_KEY);
    return;
  }

  if (!navigator.onLine || !("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;

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

  // Wait indefinitely for activation - show spinner the whole time
  await new Promise((resolve) => {
    const check = () => {
      if (pending.state === "activated" || pending.state === "redundant") {
        pending.removeEventListener("statechange", check);
        resolve();
      }
    };
    pending.addEventListener("statechange", check);
    check(); // Check immediately in case it already activated
  });

  spinner.remove();
  sessionStorage.setItem(UPDATE_CHECK_KEY, "1");
  window.location.reload();
}
```

**Pros:** Guarantees SW is activated before reload
**Cons:** User sees spinner for full 15s (but at least it works correctly)

### Solution C: Skip Reauth Update Check on Slow Networks (Pragmatic Fix)
Only check for updates on reauth if the initial page load completed quickly:

```javascript
const UPDATE_CHECK_KEY = "mcr_update_checked";
const LAST_SW_CHECK_TIME = "mcr_last_sw_check";

async function checkForUpdateBeforePin(containerEl) {
  if (sessionStorage.getItem(UPDATE_CHECK_KEY)) {
    sessionStorage.removeItem(UPDATE_CHECK_KEY);
    return;
  }

  if (!navigator.onLine || !("serviceWorker" in navigator)) return;
  
  // Skip if we checked recently (within last 5 minutes)
  const lastCheck = sessionStorage.getItem(LAST_SW_CHECK_TIME);
  if (lastCheck && Date.now() - parseInt(lastCheck) < 5 * 60 * 1000) {
    return;
  }

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;

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
    sessionStorage.setItem(LAST_SW_CHECK_TIME, Date.now().toString());
    return; 
  }

  // Wait for activation with a reasonable timeout
  const activated = await new Promise((resolve) => {
    if (pending.state === "activated") { resolve(true); return; }
    const onStateChange = () => {
      if (pending.state === "activated" || pending.state === "redundant") {
        pending.removeEventListener("statechange", onStateChange);
        resolve(true);
      }
    };
    pending.addEventListener("statechange", onStateChange);
    setTimeout(() => resolve(false), 15000);  // 15s timeout
  });

  spinner.remove();

  if (activated) {
    sessionStorage.setItem(UPDATE_CHECK_KEY, "1");
    sessionStorage.setItem(LAST_SW_CHECK_TIME, Date.now().toString());
    window.location.reload();
  } else {
    // Install is taking too long - let it finish in background
    // sw-reload.js will catch controllerchange and reload
    showToast("Update downloading in background...");
    sessionStorage.setItem(LAST_SW_CHECK_TIME, Date.now().toString());
  }
}
```

**Pros:** 
- Handles both fast and slow updates gracefully
- Prevents redundant checks
- User isn't blocked for 15s if install is slow
**Cons:** More complex logic

## Recommended Fix

**Use Solution B** (Wait for Activation Properly) because:
1. It guarantees correctness
2. The user gets clear feedback (spinner shows the whole time)
3. Better to wait 15s and work correctly than fail silently
4. The 15s is likely a worst-case scenario (maybe offline manifest fetch?)

**Also add timeout safety** with user feedback:
- After 30s, give up and show an error message
- Let them cancel and try manual hard refresh

## Additional Investigation Needed

### Why is the install taking 15 seconds?
Check the service worker install event in `sw.js:42-95`. Possible causes:
1. Slow network for manifest fetch
2. Large vendor files taking time to download
3. Old cache copying is slow
4. Multiple file fetches not parallelizing properly

### Test the actual SW install time:
```javascript
// Add to sw.js install event
const startTime = Date.now();
console.log('[SW] Install started');

// ... existing install code ...

console.log(`[SW] Install completed in ${Date.now() - startTime}ms`);
```

## Testing Plan

1. **Test Solution B locally:**
   - Throttle network to "Slow 3G" in DevTools
   - Lock the session
   - Click Continue button
   - Verify spinner shows for full install time
   - Verify updates apply correctly on reload

2. **Test on actual device (Chromebook):**
   - Deploy updated code
   - Test with both fast and slow connections
   - Verify no double-reload issues

3. **Test edge cases:**
   - Offline reauth (should show PIN immediately, no update check)
   - Rapid lock/unlock cycles
   - Timeout scenarios (if install hangs)
