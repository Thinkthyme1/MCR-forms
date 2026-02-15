# MCR Forms Offline (Vanilla JS PWA)

Offline-first crisis forms web app for mobile crisis response staff. Runs entirely in the browser on company-issued Chromebooks (and any device with Chrome), requires no installation or admin privileges, and stores no data on any server.

## Run locally

1. `npm install`
2. `npm run start`
3. Open `http://localhost:5173`

## Deploying updates

Run the manifest generator before each deploy:

```
node generate-manifest.js
```

This hashes every critical asset and auto-bumps `appVersion` / `vendorVersion` in `cache-manifest.json` when files change. The service worker uses these hashes for delta updates — only changed files are downloaded.

- **App files** (~84 KB) are in `mcr-app-vN` cache — updated frequently.
- **Vendor files** (html2pdf, ~906 KB) are in `mcr-vendor-vN` cache — updated rarely.

Normal deploys never re-download the vendor bundle.

## Security model

- No backend, no API calls for form operation.
- PHI encrypted at rest with AES-256-GCM via Web Crypto.
- Session key derived from per-case PIN using PBKDF2 SHA-256 with 600,000 iterations.
- PIN and derived key are never persisted.
- Auto-save every 30 seconds to encrypted IndexedDB blob.
- Manual and inactivity lock destroy in-memory key and require PIN re-entry.
- PHI delete path uses overwrite-then-delete for IndexedDB PHI entries and removes session salt.

## Features

- PWA with service worker offline cache and installable manifest.
- Two-cache service worker: vendor cache (large, stable) + app cache (small, frequent updates) with manifest-driven delta updates.
- Critical asset self-check with offline warning and online recache attempt.
- Redundant critical asset mirror in IndexedDB.
- Views: General Info, Staff Info, ROI (multi-instance), Notice.
- Live binding from General/Staff info into forms.
- Touch signature capture with lock/unlock toggle and clear actions.
- Hold-to-confirm PHI deletion (1.5s), including lock-screen forgotten PIN path.
- Local PDF generation (US Letter, selectable text, embedded signature image).
- Optional default save-folder picker via File System Access API when available.

## Project structure

```
index.html              Single-page app shell
styles.css              All styles including @media print rules
sw.js                   Service worker (two-cache, manifest-driven)
cache-manifest.json     Generated file hashes (do not edit manually)
generate-manifest.js    Node script to regenerate cache-manifest.json
manifest.webmanifest    PWA manifest (app name, icons, etc.)
src/
  main.js               App entry point and all view logic
  constants.js          App version, critical asset list, legal text
  state.js              State shape and helpers
  db.js                 IndexedDB wrapper (PHI, staff, meta, assets)
  crypto.js             AES-256-GCM encrypt/decrypt, PBKDF2 key derivation
  signature-pad.js      Canvas-based signature capture with lock/unlock
  pdf.js                PDF generation helpers
  ui.js                 Startup prompt / dialog utilities
vendor/
  html2pdf.bundle.min.js  Vendored html2pdf (html2canvas + jsPDF)
assets/
  benchmark-logo.svg    Company logo
```

## Notes

- Legal text currently uses explicit placeholders and should be replaced with approved final language.
- Run `npm audit --omit=dev` in an online environment before production deployment.
