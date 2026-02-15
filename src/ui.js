import { HOLD_CONFIRM_MS } from "./constants.js";

export function $(id) {
  return document.getElementById(id);
}

export function showToast(message, ms = 2600) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.setTimeout(() => toast.classList.add("hidden"), ms);
}

export function setHoldToConfirm({ button, progress, onConfirm, holdMs = HOLD_CONFIRM_MS }) {
  let timer = null;
  let startedAt = 0;
  let raf = null;

  const clearVisual = () => {
    progress.style.setProperty("--hold", "0%");
    progress.classList.remove("active");
  };

  const tick = () => {
    const elapsed = performance.now() - startedAt;
    const pct = Math.min(100, (elapsed / holdMs) * 100);
    progress.style.setProperty("--hold", `${pct}%`);
    if (pct < 100) raf = requestAnimationFrame(tick);
  };

  const start = (e) => {
    if (e.type === "contextmenu") return;
    if (e.type === "keydown" && e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    startedAt = performance.now();
    progress.classList.add("active");
    tick();
    timer = window.setTimeout(() => {
      cancel();
      onConfirm();
    }, holdMs);
  };

  const cancel = () => {
    if (timer) window.clearTimeout(timer);
    timer = null;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    clearVisual();
  };

  button.addEventListener("pointerdown", start);
  button.addEventListener("contextmenu", (e) => e.preventDefault());
  button.addEventListener("pointerup", cancel);
  button.addEventListener("pointerleave", cancel);
  button.addEventListener("pointercancel", cancel);
  button.addEventListener("keydown", start);
  button.addEventListener("keyup", cancel);

  return { cancel };
}

export function startupPrompt({
  title,
  message,
  fields = [],
  primaryLabel = "Continue",
  secondaryLabel = "Cancel",
  hideSecondary = false
}) {
  const startupScreen = $("startupScreen");
  const startupMessage = $("startupMessage");
  const startupActions = $("startupActions");

  startupScreen.classList.remove("hidden");
  startupMessage.innerHTML = `<strong>${title}</strong><br>${message}`;
  startupActions.innerHTML = "";

  const inputs = [];
  for (const field of fields) {
    const wrap = document.createElement("label");
    wrap.textContent = field.label;
    const input = document.createElement("input");
    input.type = field.type || "text";
    input.inputMode = field.inputMode || "text";
    input.maxLength = field.maxLength || 200;
    input.autocomplete = "off";
    startupActions.appendChild(wrap);
    wrap.appendChild(input);
    inputs.push(input);
  }

  const error = document.createElement("p");
  error.className = "error";
  startupActions.appendChild(error);

  const primary = document.createElement("button");
  primary.type = "button";
  primary.textContent = primaryLabel;

  const secondary = document.createElement("button");
  secondary.type = "button";
  secondary.textContent = secondaryLabel;

  startupActions.appendChild(primary);
  if (!hideSecondary) startupActions.appendChild(secondary);

  if (inputs[0]) inputs[0].focus();

  return new Promise((resolve) => {
    const submit = () => resolve({ action: "primary", values: inputs.map((i) => i.value), setError: (msg) => (error.textContent = msg) });
    primary.addEventListener("click", submit);
    secondary.addEventListener("click", () => resolve({ action: "secondary", values: [], setError: (msg) => (error.textContent = msg) }));
    for (const input of inputs) {
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    }
  });
}

export function hideStartup() {
  $("startupScreen").classList.add("hidden");
}
