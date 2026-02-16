# Change Log — rabbit-playground branch

## Push 1 — Fix PIN screen hanging on update check

**Problem:** When the PIN entry screen appeared, it would check for SW updates and hang indefinitely. Two root causes:
1. `sw-reload.js` and `main.js` both handled SW activation/reload with different sessionStorage keys, racing each other.
2. No timeout on the SW activation wait — if activation never completed, it hung forever.

**Changes:**
- `main.js` (~line 380, `checkForUpdateBeforePin`): Added 15-second timeout to SW activation wait. On timeout, just shows PIN screen; update applies next load.
- `index.html`: Removed `sw-reload.js` script tag to eliminate the race condition.
