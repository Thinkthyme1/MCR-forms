# Project: MCR Forms Offline PWA

Offline-first crisis forms for mobile crisis response staff. Handles PHI (Protected Health Information). No backend, no server, everything runs in the browser.

## Deploy workflow

Every time you change any file that ships to users, run the manifest generator before committing:

```
node generate-manifest.js
```

This will:
1. Hash all critical assets and detect changes
2. Auto-bump `appVersion` (app files) and/or `vendorVersion` (html2pdf) in `cache-manifest.json`
3. Stamp `sw.js` line 1 with the new version fingerprint so the browser detects the update

Also bump `APP_VERSION` in `src/constants.js` for user-visible version tracking.

Do NOT edit `cache-manifest.json` or the `sw.js` stamp comment manually.

## Architecture

Vanilla JS SPA. No bundler, no framework, no build step (except the manifest generator). All source files are ES modules loaded directly by the browser.

- `src/main.js` — app entry point, all view logic, PIN/session flows
- `src/constants.js` — version, timing constants, legal text placeholders, critical asset list
- `src/state.js` — pure state shape and helpers (no side effects)
- `src/db.js` — IndexedDB wrapper with device-key encryption for staff data and pepper storage
- `src/crypto.js` — AES-256-GCM encrypt/decrypt, PBKDF2 key derivation, pepper generation
- `src/signature-pad.js` — canvas-based signature capture with lock/unlock
- `src/pdf.js` — filename builder for PDF export
- `src/ui.js` — startup prompt, toast, hold-to-confirm utilities
- `sw.js` — service worker with two-cache strategy (vendor + app) and manifest-driven delta updates
- `vendor/html2pdf.bundle.min.js` — vendored html2pdf loaded via script tag (not via npm)

## Security rules

- Never use `innerHTML`. Always use DOM construction (`createElement`, `textContent`, `appendChild`).
- PHI is encrypted at rest with AES-256-GCM. Session key derived from PIN + salt + device-bound pepper via PBKDF2 (600K iterations).
- Staff info is encrypted with a device-bound non-extractable CryptoKey.
- The PIN and derived key are never persisted. They exist only in memory during an active session.
- PHI deletion uses overwrite-then-delete (write random bytes over the record, then delete).
- The service worker only caches `response.ok` responses to prevent cache poisoning.
- CSP includes `upgrade-insecure-requests`, `frame-ancestors 'none'`, no `unsafe-inline`/`unsafe-eval`.

## Service worker caching

Two caches: `mcr-app-vN` (small app files, ~84KB) and `mcr-vendor-vN` (html2pdf, ~906KB). On install, the SW fetches `cache-manifest.json` and only downloads files whose hashes changed since the previous version. The vendor cache survives app cache bumps.

The app checks for SW updates on every PIN entry (new session or resume). If a new version installed, the user is prompted to reload.

## ROI instances

ROIs are multi-instance (roi-1, roi-2, etc.). Each has independent form data, signatures, and signature lock states. PDF filenames include the ROI number (e.g. "AB 2.15.26 ROI 1.pdf").

## Testing

No test framework. Manual QA in Chrome. Run `npm audit --omit=dev` before production deployments.
