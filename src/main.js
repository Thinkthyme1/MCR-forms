import {
  AUTO_SAVE_MS,
  CRITICAL_ASSETS,
  HOLD_CONFIRM_MS,
  INACTIVITY_LOCK_MS,
  NOTICE_SECTIONS
} from "./constants.js";
import {
  deleteSalt,
  getDefaultDirHandle,
  getSalt,
  getSessionBlob,
  getStaffInfo,
  hasAssetMirror,
  overwriteAndDelete,
  setAssetMirror,
  setDefaultDirHandle,
  setSalt,
  setSessionBlob,
  setStaffInfo,
  STORES
} from "./db.js";
import { decryptJson, deriveAesKey, encryptJson, generateSalt, toBase64, fromBase64 } from "./crypto.js";
import { attachSignaturePad } from "./signature-pad.js";
import { buildFileName, createNoticePdf, createRoiPdf } from "./pdf.js";
import { $, hideStartup, setHoldToConfirm, showToast, startupPrompt } from "./ui.js";
import { clientFullName, createEmptyRoi, createInitialState, getActiveRoi, hasPhi, staffFullName, upsertActiveRoi } from "./state.js";

let state = createInitialState();
let sessionKey = null;
let pinSalt = null;
let autosaveTimer = null;
let inactivityTimer = null;
let directoryHandle = null;

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
  clearNoticeSigBtn: $("clearNoticeSigBtn"),
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
  roiClientName: $("roiClientName"),
  roiClientDob: $("roiClientDob"),
  roiStaffName: $("roiStaffName"),
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
  roiInit1B: $("roiInit1B"),
  roiInit2A: $("roiInit2A"),
  roiInit2B: $("roiInit2B"),
  roiInit3A: $("roiInit3A"),
  roiInit3B: $("roiInit3B"),
  roiDurationOneYear: $("roiDurationOneYear"),
  roiDurationServicePeriod: $("roiDurationServicePeriod"),
  roiNotes: $("roiNotes"),
  roiPrintName: $("roiPrintName"),
  roiTodayDate: $("roiTodayDate"),
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
let noticeSigPad;

function clone(obj) {
  return structuredClone(obj);
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
  fields.roiStaffName.textContent = staffFullName(state);
  fields.noticeClientName.textContent = clientFullName(state);
  fields.noticeClientDob.textContent = state.general.dob || "";
  fields.noticeStaffName.textContent = staffFullName(state);
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
  fields.roiInit1B.value = roi.init1b || "";
  fields.roiInit2A.value = roi.init2a || "";
  fields.roiInit2B.value = roi.init2b || "";
  fields.roiInit3A.value = roi.init3a || "";
  fields.roiInit3B.value = roi.init3b || "";
  fields.roiDurationOneYear.checked = roi.durationChoice === "oneYear";
  fields.roiDurationServicePeriod.checked = roi.durationChoice !== "oneYear";
  fields.roiNotes.value = roi.notes || "";
  fields.roiPrintName.textContent = clientFullName(state);
  fields.roiTodayDate.textContent = roi.date || new Date().toISOString().slice(0, 10);

  fields.noticeSummary1.value = state.notice.summary1;
  fields.noticeSummary2.value = state.notice.summary2;
  fields.noticeSummary3.value = state.notice.summary3;
  fields.noticeDate.value = state.notice.date;
  fields.noticeTime.value = state.notice.time;

  populateRoiSelector();
  bindLiveText();
  renderView();

  if (roiSigPad && noticeSigPad) {
    roiSigPad.fromDataUrl(roi.signature);
    noticeSigPad.fromDataUrl(state.notice.signature);
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
  if (!sessionKey || !hasPhi(state)) return;
  const encrypted = await encryptJson(sessionKey, sessionPayload());
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

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  await navigator.serviceWorker.register("sw.js");
}

function resolveAssetUrl(path) {
  return new URL(path, window.location.href).toString();
}

async function mirrorAsset(path) {
  const response = await fetch(resolveAssetUrl(path), { cache: "reload" });
  if (!response.ok) throw new Error("asset fetch failed");
  const bytes = new Uint8Array(await response.arrayBuffer());
  await setAssetMirror(path, bytes);
}

async function verifyCriticalAssets() {
  const cache = await caches.open("mcr-forms-cache-v1");
  let missingAny = false;
  for (const asset of CRITICAL_ASSETS) {
    const assetUrl = resolveAssetUrl(asset);
    const fromCache = await cache.match(assetUrl);
    const inMirror = await hasAssetMirror(asset);
    if (!fromCache || !inMirror) {
      missingAny = true;
      if (navigator.onLine) {
        try {
          await cache.add(assetUrl);
        } catch {
          // Keep warning behavior below if recache is not possible.
        }
        await mirrorAsset(asset).catch(() => {});
      }
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
    sessionKey = await deriveAesKey(pin, pinSalt);
    await setSalt(toBase64(pinSalt));
    hideStartup();
    return;
  }
}

async function tryUnlockWithPin(pin) {
  const blob = await getSessionBlob();
  const saltValue = await getSalt();
  if (!blob || !saltValue) throw new Error("No session state available");
  const key = await deriveAesKey(pin, fromBase64(saltValue));
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
  await overwriteAndDelete(STORES.phi, "sessionBlob");
  await overwriteAndDelete(STORES.meta, "pinSalt");
  await deleteSalt();

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
  await savePhiEncrypted();
  showToast("Ready for new client.");
  updateInactivityTimer();
}

async function resumeOrStartFlow() {
  const existingBlob = await getSessionBlob();
  const existingSalt = await getSalt();

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
        hideStartup();
        return;
      } catch (error) {
        if (isWrongPinError(error)) {
          pinResult.setError("Incorrect PIN, try again.");
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
        return;
      }
    }
  }

  await setNewPinFlow();
}

async function lockSession() {
  if (!hasPhi(state)) return;
  try {
    if (sessionKey) await savePhiEncrypted();
  } catch {
    showToast("Could not save before lock. Unlock may require start over.");
  }
  clearSessionKey();
  ui.lockOverlay.classList.remove("hidden");
  ui.unlockPrompt.classList.add("hidden");
  ui.continueBtn.classList.remove("hidden");
}

async function unlockSession(pin) {
  try {
    await tryUnlockWithPin(pin);
    ui.lockOverlay.classList.add("hidden");
    ui.unlockPrompt.classList.add("hidden");
    ui.continueBtn.classList.remove("hidden");
    ui.unlockError.textContent = "";
    ui.unlockPin.value = "";
    ui.forgotPinWrap.classList.add("hidden");
    renderState();
    showToast("Session restored.");
    updateInactivityTimer();
  } catch (error) {
    if (!isWrongPinError(error)) {
      ui.unlockError.textContent = "Session data unavailable. Delete case data to start over.";
      ui.forgotPinWrap.classList.remove("hidden");
      return;
    }
    ui.unlockError.textContent = "Incorrect PIN";
    ui.forgotPinWrap.classList.remove("hidden");
  }
}

async function saveStaffOnly() {
  await setStaffInfo(clone(state.staff));
}

async function savePdfBlob(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });

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
  link.click();
  URL.revokeObjectURL(link.href);
  showToast(`Downloaded ${filename}`);
}

async function createPdfForActiveView() {
  if (state.currentView === "roi") {
    const roi = getActiveRoi(state);
    const pdfBytes = await createRoiPdf(state, roi);
    await savePdfBlob(pdfBytes, buildFileName("ROI", state.general));
    return;
  }
  if (state.currentView === "notice") {
    const pdfBytes = await createNoticePdf(state, NOTICE_SECTIONS);
    await savePdfBlob(pdfBytes, buildFileName("Notice", state.general));
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
  fields.roiInit1B.addEventListener("input", (e) => {
    upsertActiveRoi(state, { init1b: e.target.value.toUpperCase() });
    e.target.value = e.target.value.toUpperCase();
    markChanged();
  });
  fields.roiInit2A.addEventListener("input", (e) => {
    upsertActiveRoi(state, { init2a: e.target.value.toUpperCase() });
    e.target.value = e.target.value.toUpperCase();
    markChanged();
  });
  fields.roiInit2B.addEventListener("input", (e) => {
    upsertActiveRoi(state, { init2b: e.target.value.toUpperCase() });
    e.target.value = e.target.value.toUpperCase();
    markChanged();
  });
  fields.roiInit3A.addEventListener("input", (e) => {
    upsertActiveRoi(state, { init3a: e.target.value.toUpperCase() });
    e.target.value = e.target.value.toUpperCase();
    markChanged();
  });
  fields.roiInit3B.addEventListener("input", (e) => {
    upsertActiveRoi(state, { init3b: e.target.value.toUpperCase() });
    e.target.value = e.target.value.toUpperCase();
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
  fields.roiNotes.addEventListener("input", (e) => {
    upsertActiveRoi(state, { notes: e.target.value });
    markChanged();
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

  noticeSigPad = attachSignaturePad($("noticeSignature"), () => {
    state.notice.signature = noticeSigPad.isBlank() ? "" : noticeSigPad.toDataUrl();
    markChanged();
  });

  ui.clearRoiSigBtn.addEventListener("click", () => {
    roiSigPad.clear();
    upsertActiveRoi(state, { signature: "" });
    markChanged();
  });

  ui.clearNoticeSigBtn.addEventListener("click", () => {
    noticeSigPad.clear();
    state.notice.signature = "";
    markChanged();
  });
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

async function bootstrap() {
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
  renderState();
});
