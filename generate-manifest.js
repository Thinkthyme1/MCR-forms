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
  "src/sw-reload.js",
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
  // Strip generated stamps so they don't affect their own hashes
  if (filePath === "sw.js") content = content.replace(/^\/\* manifest:.*\*\/\n/, "");
  if (filePath === "src/constants.js") content = content.replace(/APP_VERSION = "[^"]*"/, 'APP_VERSION = "0.0.0"');
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

// Auto-bump APP_VERSION in constants.js when app files change
const constantsPath = path.resolve(__dirname, "src/constants.js");
let newAppVersion;
if (appChanged) {
  const cSrc = fs.readFileSync(constantsPath, "utf8");
  const m = cSrc.match(/APP_VERSION = "(\d+)\.(\d+)\.(\d+)"/);
  if (m) {
    newAppVersion = `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
    fs.writeFileSync(constantsPath, cSrc.replace(/APP_VERSION = "[^"]*"/, `APP_VERSION = "${newAppVersion}"`));
    console.log(`src/constants.js — APP_VERSION bumped to ${newAppVersion}`);
  }
}

// Stamp sw.js with the version fingerprint so the browser detects
// any file change as a sw.js byte change → triggers SW update.
const swPath = path.resolve(__dirname, "sw.js");
const swSrc = fs.readFileSync(swPath, "utf8");
const stamp = `/* manifest: app-v${appVersion} vendor-v${vendorVersion} */`;
const stamped = swSrc.replace(/^(\/\* manifest:.*\*\/\n)?/, stamp + "\n");
fs.writeFileSync(swPath, stamped);

console.log(
  `cache-manifest.json — app: v${appVersion}${appChanged ? " (changed)" : ""}, vendor: v${vendorVersion}${vendorChanged ? " (changed)" : ""}${newAppVersion ? `, APP_VERSION: ${newAppVersion}` : ""}`
);
