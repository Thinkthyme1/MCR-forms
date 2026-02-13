# MCR Forms Offline (Vanilla JS PWA)

Offline-first crisis forms web app built to the specification in `crisis-forms-pwa-spec.md`.

## Run locally

1. Install dependencies:
   - `npm install`
2. Start static server:
   - `npm run start`
3. Open:
   - `http://localhost:5173`

## Security model

- No backend, no API calls for form operation.
- PHI encrypted at rest with AES-256-GCM via Web Crypto.
- Session key derived from per-case PIN using PBKDF2 SHA-256 with `600000` iterations.
- PIN and derived key are never persisted.
- Auto-save every 30 seconds to encrypted IndexedDB blob.
- Manual and inactivity lock destroy in-memory key and require PIN re-entry.
- PHI delete path uses overwrite-then-delete for IndexedDB PHI entries and removes session salt.

## Features implemented

- PWA with service worker offline cache and installable manifest.
- Critical asset self-check with offline warning and online recache attempt.
- Redundant critical asset mirror in IndexedDB.
- Views: General Info, Staff Info, ROI (multi-instance), Notice.
- Live binding from General/Staff info into forms.
- Touch signature capture with clear actions.
- Hold-to-confirm PHI deletion (1.5s), including lock-screen forgotten PIN path.
- Local PDF generation (US Letter, selectable text, embedded signature image).
- Optional default save-folder picker via File System Access API when available.

## Notes

- Legal text currently uses explicit placeholders and should be replaced with approved final language.
- Run `npm audit --omit=dev` in an online environment before production deployment.
