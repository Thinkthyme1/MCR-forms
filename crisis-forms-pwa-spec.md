# Crisis Forms PWA — Technical Specification

## Project Summary

A Progressive Web App for mobile crisis response staff who need to complete client-facing paperwork (Release of Information, Notice of Privacy Practices, and potentially clinical assessment forms) in the field, often with no cellular or wifi connectivity. The app runs entirely in the browser on company-issued Chromebooks (and any other device with Chrome), requires no installation or admin privileges, and stores no data on any server. All Protected Health Information is AES-256 encrypted at rest on-device and can be completely destroyed by the staff member when finished.

This is a tool that replaces paper forms. Staff fill out forms, capture client signatures with a touchscreen, generate PDFs, and upload those PDFs to the EHR system (myEvolv) once they're back on a network and the case has been created.

---

## Architecture Constraints

### Platform
- Must run in Chrome on ChromeOS. Must also work on Windows (Chrome or Edge) and mobile browsers.
- No server-side logic. No backend. No database. No API calls. Zero data leaves the device unless the user explicitly exports a PDF.
- Must function as a Progressive Web App with full offline capability.
- Must operate within MDM restrictions — no system-level installs, no admin privileges, no sideloading.

### PWA / Offline Strategy
- A service worker must cache all application assets (HTML, JS, CSS, fonts, any bundled libraries) on first visit.
- After initial load on wifi, the app must function with zero network connectivity indefinitely.
- The app should support Chrome's "Install to shelf/home screen" flow, which promotes it from a browser tab to an installed app in Chrome's eyes and grants more persistent storage.
- On every launch, before presenting any forms, the app must perform a self-check: verify that all critical assets are present in cache. If anything is missing and the device is offline, display a clear warning: "Some app files are missing. Connect to wifi and reload before going into the field." If online, silently re-cache.
- Critical assets should be redundantly stored in both the Cache API and IndexedDB as a belt-and-suspenders measure.
- Request persistent storage permission via `navigator.storage.persist()` on install to prevent Chrome from evicting cached data under storage pressure.

### Security
- All PHI stored on-device (IndexedDB, Cache API, or any other local storage) must be encrypted using AES-256-GCM via the Web Crypto API (native to Chrome, no external library needed).
- Encryption key management: PIN-derived key using PBKDF2 (built into Web Crypto).
  - When staff begins a new client session, the app prompts them to set a short PIN (4-6 digits).
  - The PIN is run through PBKDF2 with a high iteration count (minimum 600,000) and a random salt to derive an AES-256-GCM key.
  - The salt is stored in IndexedDB (it is not secret). The PIN and derived key are NEVER written to storage. The PIN is held in memory only long enough to derive the key, then discarded. The derived key lives in memory for the duration of the session.
  - On tab close, crash, or device restart, the key is lost from memory. The encrypted data remains in IndexedDB but is only recoverable by re-entering the correct PIN (which re-derives the same key from the stored salt).
  - Wrong PIN → decryption fails → No data is exposed. (See "On incorrect PIN" under "Inactivity lockout...")
  - **The PIN is per-case, not permanent.** Each new client session prompts the staff member to create a fresh PIN. It exists only for the life of that case.

- Inactivity lockout / manual lock: the app has a single lock screen that can be triggered two ways:
  - **Automatic:** 30 minutes of no user interaction (no taps, typing, or scrolling) while PHI exists in the session.
  - **Manual:** a "Lock" button in the top panel (available whenever PHI exists in the session). For when the staff member needs to go dark immediately — client glances over, someone approaches, or they need to drop the device and move.
  - Both triggers produce identical behavior: the in-memory encryption key is destroyed, a full-screen black overlay replaces all content (no PHI visible, no UI elements except a single "Continue" button centered on screen), and re-entry requires the PIN. On correct PIN entry, the key is re-derived and the session resumes exactly where it was. Same code path for both triggers.
  - On incorrect PIN: the app displays "Incorrect PIN" with two options:
    - **"Try again"** — clears the PIN field, lets them retry.
    - **"Delete case data and start over"** — triggers the same PHI deletion routine as the Delete PHI button (overwrite with random bytes, wipe salt, destroy everything, staff info survives). This is the escape hatch for a forgotten PIN. Must use the same 1.5-second hold-to-confirm pattern as the Delete PHI button to prevent accidental data loss.
- On PHI deletion: overwrite all PHI-containing storage entries with random data before deleting them. This is the closest approximation to bit-bucket-level destruction available in a browser sandbox. Clear the encryption key from memory. Cycle through IndexedDB object stores and Cache API entries that held PHI and confirm deletion.
- Staff information is stored separately from PHI and is NOT deleted during PHI wipe. Staff info may be stored unencrypted or with a persistent key, since it contains no PHI.
- Auto-save every 30 seconds. Each auto-save encrypts before writing.

### Dependency Policy
- Minimize external dependencies. Every third-party library included must be:
  - Audited for known vulnerabilities (check npm audit / Snyk / similar).
  - Pinned to a specific version.
  - Bundled into the app at build time (not loaded from a CDN at runtime, since the app must work offline).
- Prefer Web Platform APIs over libraries where feasible (Web Crypto over crypto-js, Canvas API over drawing libraries, etc.).
- Likely dependencies: a PDF generation library (pdf-lib or jsPDF — evaluate both for security posture and bundle size). A signature pad library (signature_pad) or a lightweight custom canvas implementation.

---

## Application Structure

### Layout

The app is a single-page application. The layout has two layers:

**1. Top Panel (Chevron-Expandable)**

When expanded, this panel contains the navigation and action buttons for the entire app. When collapsed, it minimizes to a small downward-pointing chevron icon fixed in the upper-right corner of the screen. Tapping the chevron expands the panel.

Contents of the expanded panel:
- **Form buttons (row or grid):**
  - "ROI" — opens the Release of Information form. Since multiple ROIs may be needed per client, this button should present a list of in-progress ROIs with an "Add New" option. If there are no existing ROIs, go ahead and just add a new ROI.
  - "Notice of Privacy Practices" — opens the Notice form.
  - (Placeholder for "Assessment" — leave a slot in the UI for a future button. Do not build the assessment form yet.)
- **Navigation buttons:**
  - "General Info" — opens the General (client) info view.
  - "Staff Info" — opens the Staff info view.
- **Session controls:**
  - "Lock" button — immediately triggers the lock screen (black overlay, PIN required to resume). Only visible when PHI exists in the current session.
  - "Delete PHI" button — visually distinct (red or warning-styled). Must be press-and-held for 1.5 seconds to activate. On press, a thin progress bar appears immediately above the button (not on or inside the button, so it remains visible and unobstructed by the user's thumb/finger). The bar fills over 1.5 seconds. If released early, the bar resets and disappears and no action is taken. On completion, the PHI deletion routine fires and the app state resets for a new client. Staff info survives. This same progress bar pattern is reused wherever a 1.5-second hold-to-confirm is required (e.g., the "Delete case data and start over" option on the lock screen).

**2. Main Content Area**

Below the top panel. Displays whichever view is currently selected (General Info, Staff Info, ROI form, Notice form). Only one view is visible at a time.

When a form (ROI or Notice) is the active view, a "Create PDF" button is positioned at the top-right of the main content area, just below the collapsed chevron panel. This button is always visible and not part of the scrollable form content.

---

## Views

### General Info View

Purpose: Collect client identifying information that auto-populates into all forms.

Fields:
- First Name (text input)
- Last Name (text input)
- Date of Birth (date input)

This data is PHI. It is encrypted at rest and destroyed on PHI deletion.

All form views (ROI, Notice) that reference client info must read from this single source. If the user changes a name or DOB in General Info, it is immediately and automatically reflected in any open form. This is a live binding, not a one-time copy.

### Staff Info View

Purpose: Collect staff member identifying information that populates into forms where a staff name is required.

Fields:
- First Name (text input)
- Last Name (text input)
- (Conditional) Default PDF save location selector — include this feature ONLY if the browser platform supports programmatic directory selection for saves (e.g., the File System Access API / `showDirectoryPicker()`). On Chromebooks and browsers that support it, present a "Choose Default Save Folder" button that lets the staff member pick where generated PDFs are saved. If the API is not available, omit this control entirely — do not show a broken or grayed-out button.

Staff info is NOT PHI. It persists across PHI deletions. It may be stored without encryption or with a separate persistent encryption key.

### ROI (Release of Information) Form View

Purpose: A standard Release of Information form that a client reads and signs.

Structure:
- The form should visually resemble a standard paper ROI — professional, readable, fits an 8.5" x 11" page when rendered to PDF.
- Client first name, last name, and DOB fields are present on the form but are auto-populated from General Info and are read-only within the form itself. If General Info changes, these fields update in real time.
- Staff name is auto-populated from Staff Info where the form requires it. Same live-binding behavior.
- The body of the form contains the standard ROI legal language. This is scrollable on screen. (Actual ROI language to be supplied later — for now, use clearly marked placeholder text that indicates where the legal language goes and approximately how much space it will occupy.)
- At the bottom of the scrollable form content: a signature capture area. This is a touch-friendly canvas where the client uses their finger or stylus to sign. Include a "Clear Signature" button to let them redo it.
- Below the signature area: date and time fields, auto-filled with now/today's date and time, editable if needed.

Multiple ROIs: The app must support creating more than one ROI per client session. Each ROI is a separate instance with its own signature. The UI should let the user navigate between them (generously sized drop-down picker).

PDF generation: The "Create PDF" button (positioned outside the form scroll area, at the top-right to the left of the chevron) takes the current state of the ROI — all field values, the legal text, and the signature image — and generates a PDF formatted to 8.5" x 11". The PDF should look like a filled-out paper form, not a screenshot. Text should be selectable in the PDF. The signature should be embedded as an image at the appropriate location, and not selectable or copyable.

### Notice of Privacy Practices Form View

Purpose: A Notice of Privacy Practices that the client reads and acknowledges with a signature.

Structure: Same general layout principles as the ROI — professional appearance, scrollable legal text, auto-populated client and staff fields with live binding, signature capture at the bottom, date field, and a "Create PDF" button. Above every legal text section (there will be many), allow for a ... cliff's notes version of what is said immediately below it (and don't you dare call it cliff's notes)

Only one Notice is needed per client session (unlike ROI, which supports multiples).

(Actual Notice language to be supplied later — use placeholder text.)

---

## Data Flow

```
User enters Staff Info (once, persists)
          |
User enters General Info (per client)
          |
    ┌─────┴──────┐
    │             │
   ROI(s)      Notice
    │             │
    └─────┬───────┘
          |
   Client signs on touchscreen
          |
   "Create PDF" → generates local PDF file, and saves it or directs user to choose save location
          |
   Staff uploads PDF to myEvolv when back on network
          |
   "Delete PHI" (hold 1.5s) → wipe all client data, signatures, forms
          |
   Ready for next client
```

---

## Auto-Save Behavior

- Every 30 seconds, the app serializes all current form state (General Info fields, all ROI instances and their field values, Notice field values, signature canvas data as base64 PNG).
- This serialized state is encrypted with the session's AES-256-GCM key (derived from PIN & salt) and written to IndexedDB.
- On app launch / reload, if encrypted saved state exists in IndexedDB, the app presents two options:
  - **"Resume previous session"** → prompts the user to enter their PIN → derives the key using the stored salt → attempts decryption. If successful, all form state is restored exactly where they left off. If the PIN is wrong, decryption fails and the app says "Incorrect PIN, try again" with no data exposed. If decryption fails, delete PHI, then show a screen that says the information was corrputed or lost and offer to start over.
  - **"Start new client"** → overwrites all encrypted PHI in IndexedDB with random bytes, deletes it, and starts a clean session with a new PIN prompt.
- This means: Chrome crashes, Chromebook restarts, tab gets accidentally closed — staff re-enter their PIN and pick up where they left off. No work lost.
- An unattended device is still safe — the encrypted data is useless without the PIN.

---

## PHI Deletion Routine

When the "Delete PHI" button is held for 1.5 seconds:

1. Show a brief confirmation state (the hold itself IS the confirmation — no additional modal).
2. Overwrite all PHI entries in IndexedDB with random bytes, then delete them.
3. Delete the stored PBKDF2 salt.
4. Clear all signature canvas data.
5. Clear all form field values (General Info, all ROIs, Notice).
6. Destroy the in-memory encryption key and PIN.
7. Reset the UI to the General Info view, blank, ready for a new client.
8. Prompt for a new PIN to begin the next session.
9. Staff Info remains untouched.
10. Display a brief confirmation: "Client data deleted. Ready for next client."

---

## PDF Generation Requirements

- Output size: 8.5" x 11" (US Letter), portrait orientation.
- The PDF should look like a professional filled-in form — not a browser print or screenshot.
- Text in the PDF must be real text (selectable, searchable), not rasterized.
- Signatures are embedded as PNG images at their designated location in the form layout.
- Client name, DOB, staff name, date, and all form fields appear in their expected positions.
- Legal body text is rendered as flowing text within the PDF, matching the on-screen form layout.
- File naming convention: suggest `[Date] [ClientFirstInitialOfFirstName][ClientFirstInitialOfLastName] [FormType].pdf` (e.g., `02.13.26 KK ROI.pdf`).
- On Chromebooks, the PDF is saved via the browser's download mechanism or, if the File System Access API is available and a default folder has been set, saved directly to that folder.

---

## Security Audit Checklist (for Codex / build process)

Before considering the build complete:

- [ ] Run `npm audit` on all dependencies. Zero high or critical vulnerabilities.
- [ ] Confirm Web Crypto API is used for all encryption — no JavaScript-only crypto libraries.
- [ ] Confirm no PHI is ever written to storage unencrypted.
- [ ] Confirm no network requests are made during normal form-filling operation (no telemetry, no analytics, no font loading, nothing).
- [ ] Confirm PHI deletion overwrites before deleting.
- [ ] Confirm encryption key never touches persistent storage.
- [ ] Confirm PIN is never written to any storage — held in memory only during key derivation, then discarded.
- [ ] Confirm PBKDF2 iteration count is at minimum 600,000.
- [ ] Confirm wrong PIN produces a clean decryption failure with no partial data exposure.
- [ ] Confirm lock screen (both manual and timeout-triggered) destroys the in-memory key, hides all PHI behind a full black overlay, and requires PIN re-entry to resume.
- [ ] Confirm service worker caches all assets and the app functions with network completely disabled.
- [ ] Confirm the self-check routine accurately detects missing cached assets.
- [ ] Confirm `navigator.storage.persist()` is requested.
- [ ] Test on ChromeOS, Windows Chrome, Windows Edge, and mobile Chrome.
- [ ] Confirm no PHI leaks into console.log, error messages, or URL parameters.
- [ ] Confirm the app makes no use of cookies, localStorage (use IndexedDB only), or sessionStorage for PHI.

---

## Future Expansion Notes (do not build yet)

- Assessment form button (slot exists in the UI panel).
- Additional form types as needed.
- Possible integration point: if myEvolv ever exposes an API, the app could theoretically push PDFs directly. For now, manual upload is the workflow.
- Multi-language support for form text if client populations require it.
- Importing client general information from dispatch material
