import {
  AUTO_SAVE_MS,
  CRITICAL_ASSETS,
  HOLD_CONFIRM_MS,
  INACTIVITY_LOCK_MS,
  MAX_PIN_ATTEMPTS,
  NOTICE_SECTIONS
} from "./constants.js";
import {
  deletePepper,
  deleteSalt,
  getDefaultDirHandle,
  getPepper,
  getSalt,
  getSessionBlob,
  getStaffInfo,
  hasAssetMirror,
  overwriteAndDelete,
  setAssetMirror,
  setDefaultDirHandle,
  setPepper,
  setSalt,
  setSessionBlob,
  setStaffInfo,
  STORES
} from "./db.js";
import { decryptJson, deriveAesKey, encryptJson, generatePepper, generateSalt, toBase64, fromBase64 } from "./crypto.js";
import { attachSignaturePad } from "./signature-pad.js";
import { $, hideStartup, setHoldToConfirm, showToast, startupPrompt } from "./ui.js";
import { buildFileName } from "./pdf.js";
import { clientFullName, createEmptyRoi, createInitialState, getActiveRoi, hasPhi, staffFullName, upsertActiveRoi } from "./state.js";

let state = createInitialState();
let sessionKey = null;
let pinSalt = null;
let autosaveTimer = null;
let inactivityTimer = null;
let directoryHandle = null;
let sessionEpoch = 0;
let unlockFailedAttempts = 0;

const ui = {
  topPanel: $("topPanel"),
  panelChevron: $("panelChevron"),
  cacheWarning: $("cacheWarning"),
  lockBtn: $("lockBtn"),
  deletePhiBtn: $("deletePhiBtn"),
  deleteProgress: $("deleteProgress"),
  createPdfBtn: $("createPdfBtn"),
  pdfActionWrap: $("pdfActionWrap"),
  noticeLegal1: $("noticeLegal1"),
  noticeLegal2: $("noticeLegal2"),
  noticeLegal3: $("noticeLegal3"),
  roiSelect: $("roiSelect"),
  addRoiBtn: $("addRoiBtn"),
  clearRoiSigBtn: $("clearRoiSigBtn"),
  clearRoiParentSigBtn: $("clearRoiParentSigBtn"),
  lockRoiSigBtn: $("lockRoiSigBtn"),
  lockRoiParentSigBtn: $("lockRoiParentSigBtn"),
  clearNoticeSigBtn: $("clearNoticeSigBtn"),
  lockNoticeSigBtn: $("lockNoticeSigBtn"),
  lockOverlay: $("lockOverlay"),
  continueBtn: $("continueBtn"),
  unlockPrompt: $("unlockPrompt"),
  unlockPin: $("unlockPin"),
  unlockSubmit: $("unlockSubmit"),
  unlockCancel: $("unlockCancel"),
  unlockError: $("unlockError"),
  forgotPinWrap: $("forgotPinWrap"),
  deleteFromLockBtn: $("deleteFromLockBtn"),
  forgotProgress: $("forgotProgress"),
  dirPickerWrap: $("dirPickerWrap"),
  pickFolderBtn: $("pickFolderBtn"),
  folderStatus: $("folderStatus")
};

const fields = {
  generalFirstName: $("generalFirstName"),
  generalLastName: $("generalLastName"),
  generalDob: $("generalDob"),
  staffFirstName: $("staffFirstName"),
  staffLastName: $("staffLastName"),
  staffRole: $("staffRole"),
  roiClientName: $("roiClientName"),
  roiClientDob: $("roiClientDob"),
  roiPurpose: $("roiPurpose"),
  roiOrganization: $("roiOrganization"),
  roiCareOf: $("roiCareOf"),
  roiAddress: $("roiAddress"),
  roiPhone: $("roiPhone"),
  roiFax: $("roiFax"),
  roiLeftTo: $("roiLeftTo"),
  roiLeftFrom: $("roiLeftFrom"),
  roiRightTo: $("roiRightTo"),
  roiRightFrom: $("roiRightFrom"),
  roiInit1A: $("roiInit1A"),
  roiInit2A: $("roiInit2A"),
  roiDurationOneYear: $("roiDurationOneYear"),
  roiDurationServicePeriod: $("roiDurationServicePeriod"),
  roiParentPrintedName: $("roiParentPrintedName"),
  roiClientPrintedName: $("roiClientPrintedName"),
  roiClientDate: $("roiClientDate"),
  roiParentDate: $("roiParentDate"),
  noticeClientName: $("noticeClientName"),
  noticeClientDob: $("noticeClientDob"),
  noticeStaffName: $("noticeStaffName"),
  noticeSummary1: $("noticeSummary1"),
  noticeSummary2: $("noticeSummary2"),
  noticeSummary3: $("noticeSummary3"),
  noticeDate: $("noticeDate"),
  noticeTime: $("noticeTime")
};

let roiSigPad;
let roiParentSigPad;

let noticeSigPad;

function clone(obj) {
  return structuredClone(obj);
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function renderView() {
  const map = {
    general: "viewGeneral",
    staff: "viewStaff",
    roi: "viewRoi",
    notice: "viewNotice"
  };
  for (const id of Object.values(map)) $(id).classList.add("hidden");
  $(map[state.currentView]).classList.remove("hidden");
  ui.pdfActionWrap.classList.toggle("hidden", !(state.currentView === "roi" || state.currentView === "notice"));
  ui.lockBtn.classList.toggle("hidden", !hasPhi(state));
}

function bindLiveText() {
  fields.roiClientName.textContent = clientFullName(state);
  fields.roiClientDob.textContent = state.general.dob || "";
  fields.noticeClientName.textContent = clientFullName(state);
  fields.noticeClientDob.textContent = state.general.dob || "";
  fields.noticeStaffName.textContent = staffFullName(state);
}

function checkText(checked) {
  return checked ? "☑" : "☐";
}

function setSigSrc(img, dataUrl) {
  if (dataUrl) {
    img.src = dataUrl;
  } else {
    img.removeAttribute("src");
  }
}

function renderPrintDivs() {
  const roi = getActiveRoi(state);
  const cName = clientFullName(state);
  const date = roi.date || todayDateString();

  /* ROI print div */
  $("prRoiClientName").textContent = cName;
  $("prRoiClientDob").textContent = state.general.dob || "";
  $("prRoiLeftTo").textContent = checkText(roi.leftTo !== false);
  $("prRoiLeftFrom").textContent = checkText(roi.leftFrom !== false);
  $("prRoiRightTo").textContent = checkText(roi.rightTo !== false);
  $("prRoiRightFrom").textContent = checkText(roi.rightFrom !== false);
  $("prRoiOrganization").textContent = roi.organization || "";
  $("prRoiCareOf").textContent = roi.careOf || "";
  $("prRoiAddress").textContent = roi.address || "";
  $("prRoiPhone").textContent = roi.phone || "";
  $("prRoiFax").textContent = roi.fax || "";
  $("prRoiInit1a").textContent = (roi.init1a || "").toUpperCase();
  $("prRoiInit2a").textContent = (roi.init2a || "").toUpperCase();
  $("prRoiPurpose").textContent = roi.purpose || "";
  $("prRoiDurationOneYear").textContent = checkText(roi.durationChoice === "oneYear");
  $("prRoiDurationService").textContent = checkText(roi.durationChoice !== "oneYear");
  setSigSrc($("prRoiClientSig"), roi.signature);
  $("prRoiClientPrintedName").textContent = cName;
  $("prRoiClientSigDate").textContent = date;
  setSigSrc($("prRoiParentSig"), roi.parentSignature);
  $("prRoiParentPrintedName").textContent = roi.parentPrintedName || "";
  $("prRoiParentSigDate").textContent = date;

  /* Notice print div */
  $("prNoticeClientName").textContent = cName;
  $("prNoticeClientDob").textContent = state.general.dob || "";
  $("prNoticeStaffName").textContent = staffFullName(state);
  $("prNoticeSummary1").textContent = state.notice.summary1 || "";
  $("prNoticeSummary2").textContent = state.notice.summary2 || "";
  $("prNoticeSummary3").textContent = state.notice.summary3 || "";
  $("prNoticeLegal1").textContent = NOTICE_SECTIONS[0].text;
  $("prNoticeLegal2").textContent = NOTICE_SECTIONS[1].text;
  $("prNoticeLegal3").textContent = NOTICE_SECTIONS[2].text;
  setSigSrc($("prNoticeClientSig"), state.notice.signature);
  $("prNoticeDate").textContent = state.notice.date || "";
  $("prNoticeTime").textContent = state.notice.time || "";
}

function populateRoiSelector() {
  ui.roiSelect.innerHTML = "";
  for (const roi of state.roi.instances) {
    const option = document.createElement("option");
    option.value = roi.id;
    option.textContent = roi.id.replace("roi-", "ROI ");
    ui.roiSelect.appendChild(option);
  }
  ui.roiSelect.value = state.roi.activeId;
}

function renderState() {
  fields.generalFirstName.value = state.general.firstName;
  fields.generalLastName.value = state.general.lastName;
  fields.generalDob.value = state.general.dob;
  fields.staffFirstName.value = state.staff.firstName;
  fields.staffLastName.value = state.staff.lastName;
  fields.staffRole.value = state.staff.role || "";

  const roi = getActiveRoi(state);
  fields.roiPurpose.value = roi.purpose || "";
  fields.roiOrganization.value = roi.organization || "";
  fields.roiCareOf.value = roi.careOf || "";
  fields.roiAddress.value = roi.address || "";
  fields.roiPhone.value = roi.phone || "";
  fields.roiFax.value = roi.fax || "";
  fields.roiLeftTo.checked = roi.leftTo !== false;
  fields.roiLeftFrom.checked = roi.leftFrom !== false;
  fields.roiRightTo.checked = roi.rightTo !== false;
  fields.roiRightFrom.checked = roi.rightFrom !== false;
  fields.roiInit1A.value = roi.init1a || "";
  fields.roiInit2A.value = roi.init2a || "";
  fields.roiDurationOneYear.checked = roi.durationChoice === "oneYear";
  fields.roiDurationServicePeriod.checked = roi.durationChoice !== "oneYear";
  fields.roiParentPrintedName.value = roi.parentPrintedName || "";
  const displayDate = roi.date || todayDateString();
  fields.roiClientPrintedName.textContent = clientFullName(state);
  fields.roiClientDate.textContent = displayDate;
  fields.roiParentDate.textContent = displayDate;

  fields.noticeSummary1.value = state.notice.summary1;
  fields.noticeSummary2.value = state.notice.summary2;
  fields.noticeSummary3.value = state.notice.summary3;
  fields.noticeDate.value = state.notice.date;
  fields.noticeTime.value = state.notice.time;

  populateRoiSelector();
  bindLiveText();
  renderPrintDivs();
  renderView();

  if (roiSigPad && roiParentSigPad && noticeSigPad) {
    roiSigPad.fromDataUrl(roi.signature);
    roiParentSigPad.fromDataUrl(roi.parentSignature || "");
    noticeSigPad.fromDataUrl(state.notice.signature);

    if (roi.sigLocked) { roiSigPad.lock(); ui.lockRoiSigBtn.textContent = "Unlock"; }
    else { roiSigPad.unlock(); ui.lockRoiSigBtn.textContent = "Lock"; }
    if (roi.parentSigLocked) { roiParentSigPad.lock(); ui.lockRoiParentSigBtn.textContent = "Unlock"; }
    else { roiParentSigPad.unlock(); ui.lockRoiParentSigBtn.textContent = "Lock"; }
    if (state.notice.sigLocked) { noticeSigPad.lock(); ui.lockNoticeSigBtn.textContent = "Unlock"; }
    else { noticeSigPad.unlock(); ui.lockNoticeSigBtn.textContent = "Lock"; }
  }
}

function updateInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  if (!hasPhi(state) || !sessionKey) return;
  inactivityTimer = setTimeout(() => lockSession(true), INACTIVITY_LOCK_MS);
}

function markChanged() {
  updateInactivityTimer();
  renderView();
}

function scrubPhiFromMemoryAndUi() {
  const savedStaff = clone(state.staff);
  state = createInitialState();
  state.staff = savedStaff;
  renderState();
}

function clearSessionKey() {
  sessionKey = null;
}

function sessionPayload() {
  return {
    currentView: state.currentView,
    general: clone(state.general),
    roi: clone(state.roi),
    notice: clone(state.notice)
  };
}

async function savePhiEncrypted() {
  const saveEpoch = sessionEpoch;
  if (!sessionKey || !hasPhi(state)) return;
  const encrypted = await encryptJson(sessionKey, sessionPayload());
  if (saveEpoch !== sessionEpoch) return;
  await setSessionBlob(encrypted);
}

async function startAutosave() {
  if (autosaveTimer) clearInterval(autosaveTimer);
  autosaveTimer = setInterval(() => {
    savePhiEncrypted().catch(() => {
      showToast("Auto-save failed");
    });
  }, AUTO_SAVE_MS);
}

function stopAutosave() {
  if (!autosaveTimer) return;
  clearInterval(autosaveTimer);
  autosaveTimer = null;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.register("sw.js", {
    updateViaCache: "none"
  });
  /* Proactively check for an updated sw.js every time the page loads.
     This ensures cache-busting even on devices (Chromebooks) where
     DevTools is unavailable for manual SW unregistration. */
  reg.update().catch(() => {});
}

async function checkForAppUpdate() {
  if (!navigator.onLine || !("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;

  try {
    await reg.update();
  } catch { return; }

  const pending = reg.installing || reg.waiting;
  if (!pending) return;

  /* Wait for the new SW to finish activating (skipWaiting fires
     immediately after install, so this is usually fast). */
  const activated = await new Promise((resolve) => {
    if (pending.state === "activated") { resolve(true); return; }
    const onStateChange = () => {
      if (pending.state === "activated" || pending.state === "redundant") {
        pending.removeEventListener("statechange", onStateChange);
        resolve(pending.state === "activated");
      }
    };
    pending.addEventListener("statechange", onStateChange);
    setTimeout(() => resolve(false), 15000);
  });

  if (!activated) return;

  const result = await startupPrompt({
    title: "App Updated",
    message: "A new version was installed. Reload to use it?",
    primaryLabel: "Reload Now",
    secondaryLabel: "Later"
  });
  if (result.action === "primary") {
    window.location.reload();
  }
}

function resolveAssetUrl(path) {
  return new URL(path, window.location.href).toString();
}

async function mirrorAsset(path, response) {
  if (!response) return;
  const bytes = new Uint8Array(await response.arrayBuffer());
  await setAssetMirror(path, bytes);
}

async function verifyCriticalAssets() {
  /* Check both vendor and app caches for all critical assets. */
  const keys = await caches.keys();
  const appCacheName = keys.find((k) => k.startsWith("mcr-app-v"));
  const vendorCacheName = keys.find((k) => k.startsWith("mcr-vendor-v"));
  if (!appCacheName) return;        // SW hasn't installed yet

  const openCaches = [];
  if (appCacheName) openCaches.push(await caches.open(appCacheName));
  if (vendorCacheName) openCaches.push(await caches.open(vendorCacheName));

  let missingAny = false;
  for (const asset of CRITICAL_ASSETS) {
    const assetUrl = resolveAssetUrl(asset);
    let fromCache = null;
    for (const c of openCaches) {
      fromCache = await c.match(assetUrl);
      if (fromCache) break;
    }
    const inMirror = await hasAssetMirror(asset);
    if (!fromCache) {
      missingAny = true;
      if (navigator.onLine && openCaches[0]) {
        try {
          await openCaches[0].add(assetUrl);
          fromCache = await openCaches[0].match(assetUrl);
        } catch {
          // Keep warning behavior below if recache is not possible.
        }
      }
    }
    if (fromCache && !inMirror) {
      await mirrorAsset(asset, fromCache.clone()).catch(() => {});
    }
  }

  if (missingAny && !navigator.onLine) {
    ui.cacheWarning.textContent = "Some app files are missing. Connect to wifi and reload before going into the field.";
    ui.cacheWarning.classList.remove("hidden");
  } else {
    ui.cacheWarning.classList.add("hidden");
  }
}

async function requestPersistentStorage() {
  if (navigator.storage?.persist) {
    await navigator.storage.persist();
  }
}

async function setNewPinFlow() {
  while (true) {
    const result = await startupPrompt({
      title: "Set Session PIN",
      message: "Create a 4 to 6 digit PIN for this client session.",
      fields: [
        { label: "PIN", type: "password", inputMode: "numeric", maxLength: 6 },
        { label: "Confirm PIN", type: "password", inputMode: "numeric", maxLength: 6 }
      ],
      primaryLabel: "Start Session",
      hideSecondary: true
    });

    const [pin, confirm] = result.values;
    if (!/^\d{4,6}$/.test(pin)) {
      result.setError("PIN must be 4 to 6 digits.");
      continue;
    }
    if (pin !== confirm) {
      result.setError("PINs do not match.");
      continue;
    }

    pinSalt = generateSalt();
    const pepper = generatePepper();
    sessionKey = await deriveAesKey(pin, pinSalt, pepper);
    await setSalt(toBase64(pinSalt));
    await setPepper(pepper);
    hideStartup();
    return;
  }
}

async function tryUnlockWithPin(pin) {
  const blob = await getSessionBlob();
  const saltValue = await getSalt();
  if (!blob || !saltValue) throw new Error("No session state available");
  const pepper = await getPepper();          // null for legacy sessions
  const key = await deriveAesKey(pin, fromBase64(saltValue), pepper);
  const decrypted = await decryptJson(key, blob);
  sessionKey = key;
  pinSalt = fromBase64(saltValue);
  state.currentView = decrypted.currentView || "general";
  state.general = decrypted.general || state.general;
  state.roi = decrypted.roi || state.roi;
  state.notice = decrypted.notice || state.notice;
}

function isWrongPinError(error) {
  return error && (error.name === "OperationError" || error.name === "InvalidAccessError");
}

async function wipePhi() {
  sessionEpoch += 1;
  stopAutosave();
  await overwriteAndDelete(STORES.phi, "sessionBlob");
  await overwriteAndDelete(STORES.meta, "pinSalt");
  await overwriteAndDelete(STORES.meta, "pinPepper");
  await deleteSalt();
  await deletePepper();

  const keys = await caches.keys();
  for (const key of keys) {
    if (key.includes("phi")) await caches.delete(key);
  }

  const savedStaff = clone(state.staff);
  state = createInitialState();
  state.staff = savedStaff;
  clearSessionKey();
  pinSalt = null;
  renderState();
}

async function startNewClientFlow() {
  await wipePhi();
  await setNewPinFlow();
  await checkForAppUpdate();
  await savePhiEncrypted();
  await startAutosave();
  showToast("Ready for new client.");
  updateInactivityTimer();
}

async function resumeOrStartFlow() {
  const existingBlob = await getSessionBlob();
  const existingSalt = await getSalt();
  let startupFailedAttempts = 0;

  if (existingBlob && existingSalt) {
    while (true) {
      const result = await startupPrompt({
        title: "Saved Session Found",
        message: "Resume previous session or start new client.",
        primaryLabel: "Resume Previous Session",
        secondaryLabel: "Start New Client"
      });

      if (result.action === "secondary") {
        await startNewClientFlow();
        return;
      }

      const pinResult = await startupPrompt({
        title: "Enter PIN",
        message: "Enter the session PIN to resume.",
        fields: [{ label: "PIN", type: "password", inputMode: "numeric", maxLength: 6 }],
        primaryLabel: "Unlock",
        secondaryLabel: "Back"
      });
      if (pinResult.action === "secondary") continue;

      try {
        await tryUnlockWithPin(pinResult.values[0]);
        startupFailedAttempts = 0;
        hideStartup();
        await checkForAppUpdate();
        return;
      } catch (error) {
        if (isWrongPinError(error)) {
          startupFailedAttempts += 1;
          if (startupFailedAttempts >= MAX_PIN_ATTEMPTS) {
            await wipePhi();
            await startupPrompt({
              title: "Too Many Incorrect PIN Attempts",
              message: "For security, case data was deleted after 5 failed attempts. Start a new client session.",
              primaryLabel: "Start New Session",
              hideSecondary: true
            });
            await setNewPinFlow();
            await checkForAppUpdate();
            return;
          }
          const attemptsRemaining = MAX_PIN_ATTEMPTS - startupFailedAttempts;
          pinResult.setError(`Incorrect PIN. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} remaining.`);
          continue;
        }
        await wipePhi();
        await startupPrompt({
          title: "Session Could Not Be Restored",
          message: "Saved information was corrupted or lost. Start a new client session.",
          primaryLabel: "Start Over",
          hideSecondary: true
        });
        await setNewPinFlow();
        await checkForAppUpdate();
        return;
      }
    }
  }

  await setNewPinFlow();
  await checkForAppUpdate();
}

async function lockSession() {
  if (!hasPhi(state)) return;
  try {
    if (sessionKey) await savePhiEncrypted();
  } catch {
    showToast("Could not save before lock. Unlock may require start over.");
  }
  clearSessionKey();
  scrubPhiFromMemoryAndUi();
  unlockFailedAttempts = 0;
  ui.lockOverlay.classList.remove("hidden");
  ui.unlockPrompt.classList.add("hidden");
  ui.continueBtn.classList.remove("hidden");
}

async function unlockSession(pin) {
  try {
    await tryUnlockWithPin(pin);
    unlockFailedAttempts = 0;
    ui.lockOverlay.classList.add("hidden");
    ui.unlockPrompt.classList.add("hidden");
    ui.continueBtn.classList.remove("hidden");
    ui.unlockError.textContent = "";
    ui.unlockPin.value = "";
    ui.forgotPinWrap.classList.add("hidden");
    renderState();
    showToast("Session restored.");
    await checkForAppUpdate();
    updateInactivityTimer();
  } catch (error) {
    if (!isWrongPinError(error)) {
      ui.unlockError.textContent = "Session data unavailable. Delete case data to start over.";
      ui.forgotPinWrap.classList.remove("hidden");
      return;
    }
    unlockFailedAttempts += 1;
    if (unlockFailedAttempts >= MAX_PIN_ATTEMPTS) {
      await startNewClientFlow();
      ui.lockOverlay.classList.add("hidden");
      ui.unlockPrompt.classList.add("hidden");
      ui.continueBtn.classList.remove("hidden");
      ui.unlockError.textContent = "";
      ui.unlockPin.value = "";
      ui.forgotPinWrap.classList.add("hidden");
      unlockFailedAttempts = 0;
      showToast("Too many incorrect PIN attempts. Case data deleted.");
      return;
    }
    const attemptsRemaining = MAX_PIN_ATTEMPTS - unlockFailedAttempts;
    ui.unlockError.textContent = `Incorrect PIN. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} remaining.`;
    ui.forgotPinWrap.classList.remove("hidden");
  }
}

async function saveStaffOnly() {
  await setStaffInfo(clone(state.staff));
}

async function savePdfBlob(blobOrBytes, filename) {
  const blob = blobOrBytes instanceof Blob
    ? blobOrBytes
    : new Blob([blobOrBytes], { type: "application/pdf" });

  if (directoryHandle) {
    try {
      const permission = await directoryHandle.requestPermission({ mode: "readwrite" });
      if (permission === "granted") {
        const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        showToast(`Saved to default folder: ${filename}`);
        return;
      }
    } catch {
      // Fall through to download path.
    }
  }

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  const objectUrl = link.href;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  showToast(`Downloaded ${filename}`);
}

async function createPdfForActiveView() {
  renderPrintDivs();

  const printId = state.currentView === "roi" ? "printRoi"
    : state.currentView === "notice" ? "printNotice"
    : null;
  if (!printId) return;

  const el = $(printId);

  /* Move on-screen so html2canvas can measure and render it. */
  el.classList.add("printing");

  /* Wait for any signature images to finish decoding. */
  const imgs = el.querySelectorAll("img[src]");
  await Promise.all(
    Array.from(imgs).map((img) => img.decode().catch(() => {}))
  );

  const roiNum = state.currentView === "roi"
    ? state.roi.instances.findIndex((r) => r.id === state.roi.activeId) + 1
    : 0;
  const formType = roiNum ? `ROI ${roiNum}` : "Notice";
  const filename = buildFileName(formType, state.general);

  try {
    /* Generate a real PDF via html2pdf (html2canvas + jsPDF).
       This bypasses window.print() / Chrome print preview entirely,
       which is unreliable on Chrome OS Chromebooks. */
    const blob = await html2pdf()
      .set({
        margin: [0.4, 0.4, 0.4, 0.4],
        filename,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "in", format: "letter", orientation: "portrait" }
      })
      .from(el)
      .outputPdf("blob");

    await savePdfBlob(blob, filename);
  } finally {
    el.classList.remove("printing");
  }
}

function bindFieldInputs() {
  fields.generalFirstName.addEventListener("input", (e) => {
    state.general.firstName = e.target.value;
    bindLiveText();
    markChanged();
  });
  fields.generalLastName.addEventListener("input", (e) => {
    state.general.lastName = e.target.value;
    bindLiveText();
    markChanged();
  });
  fields.generalDob.addEventListener("input", (e) => {
    state.general.dob = e.target.value;
    bindLiveText();
    markChanged();
  });

  fields.staffFirstName.addEventListener("input", async (e) => {
    state.staff.firstName = e.target.value;
    bindLiveText();
    await saveStaffOnly();
  });
  fields.staffLastName.addEventListener("input", async (e) => {
    state.staff.lastName = e.target.value;
    bindLiveText();
    await saveStaffOnly();
  });
  fields.staffRole.addEventListener("input", async (e) => {
    state.staff.role = e.target.value;
    renderState();
    await saveStaffOnly();
  });

  fields.roiPurpose.addEventListener("input", (e) => {
    upsertActiveRoi(state, { purpose: e.target.value });
    markChanged();
  });
  fields.roiOrganization.addEventListener("input", (e) => {
    upsertActiveRoi(state, { organization: e.target.value });
    markChanged();
  });
  fields.roiCareOf.addEventListener("input", (e) => {
    upsertActiveRoi(state, { careOf: e.target.value });
    markChanged();
  });
  fields.roiAddress.addEventListener("input", (e) => {
    upsertActiveRoi(state, { address: e.target.value });
    markChanged();
  });
  fields.roiPhone.addEventListener("input", (e) => {
    upsertActiveRoi(state, { phone: e.target.value });
    markChanged();
  });
  fields.roiFax.addEventListener("input", (e) => {
    upsertActiveRoi(state, { fax: e.target.value });
    markChanged();
  });
  fields.roiLeftTo.addEventListener("change", (e) => {
    upsertActiveRoi(state, { leftTo: e.target.checked });
    markChanged();
  });
  fields.roiLeftFrom.addEventListener("change", (e) => {
    upsertActiveRoi(state, { leftFrom: e.target.checked });
    markChanged();
  });
  fields.roiRightTo.addEventListener("change", (e) => {
    upsertActiveRoi(state, { rightTo: e.target.checked });
    markChanged();
  });
  fields.roiRightFrom.addEventListener("change", (e) => {
    upsertActiveRoi(state, { rightFrom: e.target.checked });
    markChanged();
  });
  fields.roiInit1A.addEventListener("input", (e) => {
    upsertActiveRoi(state, { init1a: e.target.value.toUpperCase() });
    e.target.value = e.target.value.toUpperCase();
    markChanged();
  });
  fields.roiInit2A.addEventListener("input", (e) => {
    upsertActiveRoi(state, { init2a: e.target.value.toUpperCase() });
    e.target.value = e.target.value.toUpperCase();
    markChanged();
  });
  fields.roiParentPrintedName.addEventListener("input", (e) => {
    upsertActiveRoi(state, { parentPrintedName: e.target.value });
    markChanged();
  });
  fields.roiDurationOneYear.addEventListener("change", (e) => {
    if (e.target.checked) {
      upsertActiveRoi(state, { durationChoice: "oneYear" });
      markChanged();
    }
  });
  fields.roiDurationServicePeriod.addEventListener("change", (e) => {
    if (e.target.checked) {
      upsertActiveRoi(state, { durationChoice: "servicePeriod" });
      markChanged();
    }
  });

  fields.noticeSummary1.addEventListener("input", (e) => {
    state.notice.summary1 = e.target.value;
    markChanged();
  });
  fields.noticeSummary2.addEventListener("input", (e) => {
    state.notice.summary2 = e.target.value;
    markChanged();
  });
  fields.noticeSummary3.addEventListener("input", (e) => {
    state.notice.summary3 = e.target.value;
    markChanged();
  });
  fields.noticeDate.addEventListener("input", (e) => {
    state.notice.date = e.target.value;
    markChanged();
  });
  fields.noticeTime.addEventListener("input", (e) => {
    state.notice.time = e.target.value;
    markChanged();
  });
}

function bindNav() {
  const syncPanelToggleLabel = () => {
    const collapsed = ui.topPanel.classList.contains("collapsed");
    ui.panelChevron.textContent = collapsed ? "Show Panel ▼" : "Hide Panel ▲";
    ui.panelChevron.setAttribute("aria-expanded", String(!collapsed));
  };

  syncPanelToggleLabel();

  ui.panelChevron.addEventListener("click", () => {
    ui.topPanel.classList.toggle("collapsed");
    syncPanelToggleLabel();
  });

  document.querySelectorAll("#formNav button[data-view], #infoNav button[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.currentView = btn.getAttribute("data-view");
      renderView();
    });
  });

  ui.roiSelect.addEventListener("change", () => {
    state.roi.activeId = ui.roiSelect.value;
    renderState();
  });

  ui.addRoiBtn.addEventListener("click", () => {
    const nextId = `roi-${state.roi.instances.length + 1}`;
    state.roi.instances.push(createEmptyRoi(nextId));
    state.roi.activeId = nextId;
    renderState();
    markChanged();
  });
}

function bindSignatures() {
  roiSigPad = attachSignaturePad($("roiSignature"), () => {
    const value = roiSigPad.isBlank() ? "" : roiSigPad.toDataUrl();
    upsertActiveRoi(state, { signature: value });
    markChanged();
  });
  roiParentSigPad = attachSignaturePad($("roiParentSignature"), () => {
    const value = roiParentSigPad.isBlank() ? "" : roiParentSigPad.toDataUrl();
    upsertActiveRoi(state, { parentSignature: value });
    markChanged();
  });
  noticeSigPad = attachSignaturePad($("noticeSignature"), () => {
    state.notice.signature = noticeSigPad.isBlank() ? "" : noticeSigPad.toDataUrl();
    markChanged();
  });

  ui.clearRoiSigBtn.addEventListener("click", () => {
    if (roiSigPad.isLocked()) return;
    roiSigPad.clear();
    upsertActiveRoi(state, { signature: "" });
    markChanged();
  });
  ui.clearRoiParentSigBtn.addEventListener("click", () => {
    if (roiParentSigPad.isLocked()) return;
    roiParentSigPad.clear();
    upsertActiveRoi(state, { parentSignature: "" });
    markChanged();
  });
  ui.clearNoticeSigBtn.addEventListener("click", () => {
    if (noticeSigPad.isLocked()) return;
    noticeSigPad.clear();
    state.notice.signature = "";
    markChanged();
  });

  function bindSigLock(btn, pad, onToggle) {
    btn.addEventListener("click", () => {
      if (pad.isLocked()) {
        pad.unlock();
        btn.textContent = "Lock";
      } else {
        pad.lock();
        btn.textContent = "Unlock";
      }
      onToggle(pad.isLocked());
      markChanged();
    });
  }
  bindSigLock(ui.lockRoiSigBtn, roiSigPad, (v) => upsertActiveRoi(state, { sigLocked: v }));
  bindSigLock(ui.lockRoiParentSigBtn, roiParentSigPad, (v) => upsertActiveRoi(state, { parentSigLocked: v }));
  bindSigLock(ui.lockNoticeSigBtn, noticeSigPad, (v) => { state.notice.sigLocked = v; });
}

function bindLockFlow() {
  ui.lockBtn.addEventListener("click", () => lockSession());

  ui.continueBtn.addEventListener("click", () => {
    ui.continueBtn.classList.add("hidden");
    ui.unlockPrompt.classList.remove("hidden");
    ui.unlockPin.focus();
  });

  ui.unlockSubmit.addEventListener("click", () => unlockSession(ui.unlockPin.value));
  ui.unlockPin.addEventListener("keydown", (e) => {
    if (e.key === "Enter") unlockSession(ui.unlockPin.value);
  });

  ui.unlockCancel.addEventListener("click", () => {
    ui.unlockPrompt.classList.add("hidden");
    ui.continueBtn.classList.remove("hidden");
    ui.unlockError.textContent = "";
    ui.unlockPin.value = "";
  });

  setHoldToConfirm({
    button: ui.deleteFromLockBtn,
    progress: ui.forgotProgress,
    holdMs: HOLD_CONFIRM_MS,
    onConfirm: async () => {
      await startNewClientFlow();
      ui.lockOverlay.classList.add("hidden");
      ui.unlockPrompt.classList.add("hidden");
      ui.continueBtn.classList.remove("hidden");
      ui.unlockError.textContent = "";
    }
  });
}

function bindDeleteFlow() {
  setHoldToConfirm({
    button: ui.deletePhiBtn,
    progress: ui.deleteProgress,
    holdMs: HOLD_CONFIRM_MS,
    onConfirm: async () => {
      await startNewClientFlow();
      showToast("Client data deleted. Ready for next client.");
    }
  });
}

function bindPdfFlow() {
  ui.createPdfBtn.addEventListener("click", () => createPdfForActiveView());
}

function bindIdleTracking() {
  const events = ["pointerdown", "keydown", "scroll", "touchstart", "mousemove"];
  for (const evt of events) {
    window.addEventListener(evt, () => updateInactivityTimer(), { passive: true });
  }
}

async function setupDirectoryPicker() {
  if (typeof window.showDirectoryPicker !== "function") return;
  ui.dirPickerWrap.classList.remove("hidden");
  directoryHandle = await getDefaultDirHandle();
  if (directoryHandle) ui.folderStatus.textContent = "Default save folder configured.";

  ui.pickFolderBtn.addEventListener("click", async () => {
    try {
      directoryHandle = await window.showDirectoryPicker();
      await setDefaultDirHandle(directoryHandle);
      ui.folderStatus.textContent = "Default save folder configured.";
      showToast("Default save folder set.");
    } catch {
      ui.folderStatus.textContent = "Folder selection canceled.";
    }
  });
}

function blockIfEmbeddedFrame() {
  let isEmbedded = false;
  try {
    isEmbedded = window.top !== window.self;
  } catch {
    isEmbedded = true;
  }
  if (!isEmbedded) return;
  document.body.textContent = "";
  const m = document.createElement("main");
  m.style.cssText = "font-family: Segoe UI, Tahoma, sans-serif; padding: 2rem; color: #111827; background: #f3f4f6; min-height: 100vh;";
  const h = document.createElement("h1");
  h.style.marginTop = "0";
  h.textContent = "Blocked";
  const p = document.createElement("p");
  p.textContent = "This app cannot run inside an embedded frame.";
  m.appendChild(h);
  m.appendChild(p);
  document.body.appendChild(m);
  throw new Error("Blocked embedded frame context");
}

async function bootstrap() {
  blockIfEmbeddedFrame();
  ui.noticeLegal1.textContent = NOTICE_SECTIONS[0].text;
  ui.noticeLegal2.textContent = NOTICE_SECTIONS[1].text;
  ui.noticeLegal3.textContent = NOTICE_SECTIONS[2].text;

  state.staff = await getStaffInfo();

  try {
    await registerServiceWorker();
  } catch {
    showToast("Service worker unavailable. Offline install may be limited.");
  }
  try {
    await verifyCriticalAssets();
  } catch {
    ui.cacheWarning.textContent = "Some app files are missing. Connect to wifi and reload before going into the field.";
    ui.cacheWarning.classList.remove("hidden");
  }
  try {
    await requestPersistentStorage();
  } catch {
    // Continue if persist permission request is unavailable.
  }

  bindFieldInputs();
  bindNav();
  bindSignatures();
  bindLockFlow();
  bindDeleteFlow();
  bindPdfFlow();
  bindIdleTracking();
  await setupDirectoryPicker();

  await resumeOrStartFlow();
  renderState();
  await startAutosave();
  updateInactivityTimer();
}

bootstrap().catch(async () => {
  await wipePhi();
  showToast("Data could not be restored. Starting over.");
  await setNewPinFlow();
  await checkForAppUpdate();
  renderState();
});
