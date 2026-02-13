function nowDate() {
  return new Date().toISOString().slice(0, 10);
}

function nowTime() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function createEmptyRoi(id) {
  return {
    id,
    purpose: "Continuity of care",
    recipient: "",
    notes: "",
    summary: "",
    signature: "",
    date: nowDate(),
    time: nowTime()
  };
}

export function createInitialState() {
  return {
    currentView: "general",
    general: {
      firstName: "",
      lastName: "",
      dob: ""
    },
    staff: {
      firstName: "",
      lastName: ""
    },
    roi: {
      activeId: "roi-1",
      instances: [createEmptyRoi("roi-1")]
    },
    notice: {
      summary1: "",
      summary2: "",
      summary3: "",
      signature: "",
      date: nowDate(),
      time: nowTime()
    }
  };
}

export function hasPhi(state) {
  return Boolean(
    state.general.firstName ||
      state.general.lastName ||
      state.general.dob ||
      state.roi.instances.some((r) => r.purpose || r.recipient || r.notes || r.summary || r.signature) ||
      state.notice.summary1 ||
      state.notice.summary2 ||
      state.notice.summary3 ||
      state.notice.signature
  );
}

export function getActiveRoi(state) {
  return state.roi.instances.find((roi) => roi.id === state.roi.activeId) || state.roi.instances[0];
}

export function upsertActiveRoi(state, patch) {
  state.roi.instances = state.roi.instances.map((roi) => (roi.id === state.roi.activeId ? { ...roi, ...patch } : roi));
}

export function staffFullName(state) {
  return [state.staff.firstName, state.staff.lastName].filter(Boolean).join(" ").trim();
}

export function clientFullName(state) {
  return [state.general.firstName, state.general.lastName].filter(Boolean).join(" ").trim();
}
