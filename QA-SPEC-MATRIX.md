# Crisis Forms PWA Spec QA Matrix

Source of truth: `crisis-forms-pwa-spec.md`

Legend: PASS = implemented and verified in code, PENDING = requires runtime/network/device validation, PARTIAL = implemented but has scope caveat.

## Core Architecture

| Requirement | Status | Evidence |
|---|---|---|
| Vanilla/browser-only SPA, no backend/API sync | PASS | `src/main.js`, no API client; all data local |
| Offline-first PWA with service worker cache | PASS | `sw.js` install/activate/fetch cache strategy |
| Self-check critical assets before forms | PASS | `src/main.js` `verifyCriticalAssets()` |
| Warn when offline + missing assets | PASS | `src/main.js` `cacheWarning` message |
| Redundant critical asset storage in Cache + IndexedDB | PASS | `sw.js` cache + `src/main.js` `mirrorAsset()` + `src/db.js` assets store |
| Request persistent storage | PASS | `src/main.js` `navigator.storage.persist()` |

## Security and Session Controls

| Requirement | Status | Evidence |
|---|---|---|
| AES-256-GCM Web Crypto encryption at rest | PASS | `src/crypto.js` AES-GCM, 256-bit key |
| PIN-derived key via PBKDF2 SHA-256 >=600k iterations | PASS | `src/constants.js` `PBKDF2_ITERATIONS = 600000`, `src/crypto.js` |
| Salt stored, PIN/key never persisted | PASS | `src/main.js` stores salt only; key variable in memory |
| Auto-save every 30s (encrypted) | PASS | `src/main.js` `AUTO_SAVE_MS`, `savePhiEncrypted()` |
| Resume previous session with PIN | PASS | `src/main.js` `resumeOrStartFlow()` |
| Wrong PIN clean failure/no exposure | PASS | `src/main.js` `isWrongPinError()` + unlock handling |
| Corruption path wipes PHI and starts over | PASS | `src/main.js` corruption branch in resume/unlock |
| Manual lock + inactivity lock (30 min), black screen + PIN resume | PASS | `src/main.js` `lockSession()`, inactivity timer, overlay in `index.html` |
| Delete PHI hold-to-confirm 1.5s | PASS | `src/ui.js` `setHoldToConfirm()`, `src/main.js` delete bindings |
| Lock-screen "Delete case data and start over" uses same hold pattern | PASS | `src/main.js` `deleteFromLockBtn` binding |
| Staff info survives PHI wipe | PASS | `src/main.js` `wipePhi()` preserves `state.staff` |

## Forms and UX

| Requirement | Status | Evidence |
|---|---|---|
| Top chevron expandable panel with required navigation/buttons | PASS | `index.html` top panel + controls |
| Views: General, Staff, ROI, Notice | PASS | `index.html` view sections |
| Assessment placeholder slot only | PASS | `index.html` disabled placeholder button |
| General info live-binds to ROI/Notice | PASS | `src/main.js` `bindLiveText()` |
| Staff info live-binds to ROI/Notice | PASS | `src/main.js` `bindLiveText()` |
| Multiple ROI instances with selector and Add New | PASS | `src/main.js` ROI selector/add flow |
| Signature capture + clear for ROI and Notice | PASS | `src/signature-pad.js`, `src/main.js` clear handlers |
| Notice has summary above each legal section | PASS | `index.html` notice summary fields above legal text blocks |
| Create PDF button visible for active form views | PASS | `src/main.js` `renderView()`, `index.html` `pdfActionWrap` |
| Optional directory picker only when supported | PASS | `src/main.js` `showDirectoryPicker` feature detection |

## PDF Requirements

| Requirement | Status | Evidence |
|---|---|---|
| 8.5x11 Letter portrait output | PASS | `src/pdf.js` page size 612x792 |
| Selectable/searchable text (not screenshot PDF) | PASS | `src/pdf.js` text operators (`BT ... Tj ET`) |
| Signature embedded as image | PASS | `src/pdf.js` JPEG image XObject embed |
| Suggested file naming convention | PASS | `src/pdf.js` `buildFileName()` |

## Security Audit Checklist

| Checklist Item | Status | Evidence |
|---|---|---|
| Run `npm audit`, zero high/critical | PENDING | Network-restricted environment prevented completion |
| Web Crypto API used, no JS-only crypto libs | PASS | `src/crypto.js` only |
| No PHI written unencrypted | PASS | PHI state writes through `encryptJson()` to `sessionBlob` |
| No network requests during normal form fill | PASS | No form-time outbound requests; startup/service-worker asset checks only |
| PHI deletion overwrites before deleting | PASS | `src/db.js` `overwriteAndDelete()` |
| Encryption key never persisted | PASS | In-memory `sessionKey` only |
| PIN never persisted | PASS | PIN used transiently in derive flow |
| PBKDF2 minimum iteration count met | PASS | `600000` constant |
| Wrong PIN clean decryption failure | PASS | wrong-pin handling branches in `src/main.js` |
| Lock screen behavior requirement met | PASS | black overlay + key clear + PIN resume |
| Service worker caches assets + offline function | PARTIAL | Implemented; full offline run-test still needed on target devices |
| Self-check detects missing cached assets | PASS | `verifyCriticalAssets()` logic |
| `navigator.storage.persist()` requested | PASS | `requestPersistentStorage()` |
| Test on ChromeOS/Windows/mobile | PENDING | not executed in this environment |
| No PHI leak via console/error/URL params | PASS | no `console.log`, no URL param usage for PHI |
| No localStorage/sessionStorage for PHI | PASS | no usage in codebase |

## Notes

- This implementation follows the requested constraints: no auth accounts, no syncing, no backend API layer.
- Remaining PENDING items are environment-dependent validation steps, not known code gaps.
