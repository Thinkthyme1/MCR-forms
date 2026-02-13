export const APP_VERSION = "1.0.0";
export const PBKDF2_ITERATIONS = 600000;
export const AUTO_SAVE_MS = 30000;
export const INACTIVITY_LOCK_MS = 30 * 60 * 1000;
export const HOLD_CONFIRM_MS = 1500;

export const CRITICAL_ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "assets/benchmark-logo.svg",
  "sw.js",
  "src/main.js",
  "src/constants.js",
  "src/state.js",
  "src/db.js",
  "src/crypto.js",
  "src/signature-pad.js",
  "src/pdf.js",
  "src/ui.js"
];

export const ROI_LEGAL_PLACEHOLDER = `
[ROI LEGAL LANGUAGE PLACEHOLDER]
This section will contain the full Release of Information legal language.
It should be replaced with the approved text provided by compliance.

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed non finibus eros.
Vestibulum vitae bibendum lorem. Pellentesque ac urna a elit tempor faucibus.
Integer ultrices nibh sed augue gravida, id luctus purus iaculis.
`.trim();

export const NOTICE_SECTIONS = [
  {
    title: "Privacy Rights and Uses",
    text: "[NOTICE PLACEHOLDER] This section will contain approved privacy rights language with disclosure boundaries and permitted uses."
  },
  {
    title: "How Information May Be Shared",
    text: "[NOTICE PLACEHOLDER] This section will describe care coordination, payment, and operational sharing rules."
  },
  {
    title: "Client Acknowledgement and Contact",
    text: "[NOTICE PLACEHOLDER] This section will include acknowledgement language and who to contact for questions."
  }
];
