#!/usr/bin/env node
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const VENDOR_FILES = ["vendor/html2pdf.bundle.min.js"];

const APP_FILES = [
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

function hash(filePath) {
  let content = fs.readFileSync(path.resolve(__dirname, filePath), "utf8");
  // Strip the version stamp from sw.js so it doesn't affect its own hash
  if (filePath === "sw.js") content = content.replace(/^\/\* manifest:.*\*\/\n/, "");
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
}

// Read existing manifest to preserve version numbers
let existing = { appVersion: 0, vendorVersion: 0, app: {}, vendor: {} };
try {
  existing = JSON.parse(fs.readFileSync(path.resolve(__dirname, "cache-manifest.json"), "utf8"));
} catch {}

const appFiles = {};
for (const f of APP_FILES) appFiles[f] = hash(f);

const vendorFiles = {};
for (const f of VENDOR_FILES) vendorFiles[f] = hash(f);

const oldAppHashes = existing.app?.files || {};
const oldVendorHashes = existing.vendor?.files || {};

const appChanged =
  Object.keys(appFiles).some((f) => appFiles[f] !== oldAppHashes[f]) ||
  Object.keys(oldAppHashes).some((f) => !(f in appFiles));

const vendorChanged =
  Object.keys(vendorFiles).some((f) => vendorFiles[f] !== oldVendorHashes[f]) ||
  Object.keys(oldVendorHashes).some((f) => !(f in vendorFiles));

let appVersion = existing.appVersion || 0;
let vendorVersion = existing.vendorVersion || 0;
if (appChanged) appVersion++;
if (vendorChanged) vendorVersion++;

const manifest = {
  appVersion,
  vendorVersion,
  app: { files: appFiles },
  vendor: { files: vendorFiles }
};

fs.writeFileSync(
  path.resolve(__dirname, "cache-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n"
);

// Stamp sw.js with the version fingerprint so the browser detects
// any file change as a sw.js byte change → triggers SW update.
const swPath = path.resolve(__dirname, "sw.js");
const swSrc = fs.readFileSync(swPath, "utf8");
const stamp = `/* manifest: app-v${appVersion} vendor-v${vendorVersion} */`;
const stamped = swSrc.replace(/^(\/\* manifest:.*\*\/\n)?/, stamp + "\n");
fs.writeFileSync(swPath, stamped);

console.log(
  `cache-manifest.json — app: v${appVersion}${appChanged ? " (changed)" : ""}, vendor: v${vendorVersion}${vendorChanged ? " (changed)" : ""}`
);
