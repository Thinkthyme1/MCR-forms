#!/usr/bin/env node
/**
 * Automated verification for the print-to-PDF flow.
 * Checks HTML structure, CSS cascade, JS logic, and SW cache version.
 * Run: node test-print.js
 */
const fs = require("fs");
const path = require("path");

let failures = 0;
function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.log(`  ✗ FAIL: ${msg}`);
    failures++;
  }
}

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
const mainJs = fs.readFileSync(path.join(__dirname, "src/main.js"), "utf8");
const swJs = fs.readFileSync(path.join(__dirname, "sw.js"), "utf8");

// ─── 1. HTML Structure ───────────────────────────────────────────
console.log("\n1. HTML Structure");

// printRoi must be a DIRECT child of #app, not nested inside <main>
const mainClosePos = html.indexOf("</main>");
const printRoiPos = html.indexOf('id="printRoi"');
const printNoticePos = html.indexOf('id="printNotice"');
assert(mainClosePos > 0, "</main> tag exists");
assert(printRoiPos > mainClosePos, "#printRoi is after </main> (not inside <main>)");
assert(printNoticePos > mainClosePos, "#printNotice is after </main> (not inside <main>)");

// printRoi must be inside #app
const appOpenPos = html.indexOf('id="app"');
// Find last closing </div> before </body> — rough check that printRoi is inside app
assert(printRoiPos > appOpenPos, "#printRoi is inside #app");

// printRoi has .print-ready class
const printRoiTag = html.slice(html.lastIndexOf("<", printRoiPos), html.indexOf(">", printRoiPos) + 1);
assert(printRoiTag.includes('class="print-ready"'), '#printRoi has class="print-ready"');

// ─── 2. CSS @media print rules ──────────────────────────────────
console.log("\n2. CSS @media print rules");

const mediaPrintMatch = css.match(/@media\s+print\s*\{([\s\S]*?)^\}/m);
assert(!!mediaPrintMatch, "@media print block exists");

if (mediaPrintMatch) {
  const printCSS = mediaPrintMatch[1];

  // Must NOT hide .app directly
  assert(!printCSS.match(/\.app\s*[,{]/), "Does NOT hide .app directly");
  assert(!printCSS.includes(".main-content"), "Does NOT hide .main-content directly");

  // Must hide .app > children except .printing
  assert(
    printCSS.includes(".app > *:not(.printing)"),
    "Hides .app > *:not(.printing)"
  );

  // Must show .print-ready.printing
  assert(
    printCSS.includes(".print-ready.printing"),
    "Has .print-ready.printing display rule"
  );
  assert(
    printCSS.includes("display: block !important"),
    ".print-ready.printing uses display: block !important"
  );
  assert(
    printCSS.includes("position: static !important"),
    ".print-ready.printing uses position: static !important"
  );

  // Must have @page rule
  assert(printCSS.includes("@page"), "Has @page rule");
  assert(printCSS.includes("size: letter"), "@page sets letter size");
}

// ─── 3. Non-print .print-ready styles ───────────────────────────
console.log("\n3. Base .print-ready styles");

// .print-ready must be off-screen by default
assert(css.includes("left: -9999px"), ".print-ready is off-screen (left: -9999px)");

// .print-ready.printing (non-print) must bring it on-screen
const printingRuleMatch = css.match(/\.print-ready\.printing\s*\{([^}]+)\}/);
assert(!!printingRuleMatch, ".print-ready.printing rule exists (non-print)");
if (printingRuleMatch) {
  assert(
    printingRuleMatch[1].includes("position: static"),
    ".print-ready.printing sets position: static"
  );
}

// ─── 4. JS createPdfForActiveView logic ─────────────────────────
console.log("\n4. JS createPdfForActiveView");

const fnMatch = mainJs.match(/function createPdfForActiveView[\s\S]*?^\}/m);
assert(!!fnMatch, "createPdfForActiveView function exists");
if (fnMatch) {
  const fn = fnMatch[0];
  assert(fn.includes("renderPrintDivs()"), "Calls renderPrintDivs()");
  assert(fn.includes('classList.add("printing")'), 'Adds "printing" class');
  assert(fn.includes("window.print()"), "Calls window.print()");
  assert(fn.includes('classList.remove("printing")'), 'Removes "printing" class after print');

  // Verify order: renderPrintDivs → classList.add → window.print → classList.remove
  const renderIdx = fn.indexOf("renderPrintDivs()");
  const addIdx = fn.indexOf('classList.add("printing")');
  const printIdx = fn.indexOf("window.print()");
  const removeIdx = fn.indexOf('classList.remove("printing")');
  assert(renderIdx < addIdx, "renderPrintDivs() called before classList.add");
  assert(addIdx < printIdx, "classList.add called before window.print");
  assert(printIdx < removeIdx, "window.print called before classList.remove");
}

// Must NOT reference html2pdf, openPrintPreview, or renderHtmlToPdfBlob
assert(!mainJs.includes("renderHtmlToPdfBlob"), "No renderHtmlToPdfBlob reference");
assert(!mainJs.includes("openPrintPreview"), "No openPrintPreview reference");
assert(
  !mainJs.includes("window.html2pdf"),
  "No window.html2pdf() call"
);

// ─── 5. Service Worker cache version ────────────────────────────
console.log("\n5. Service Worker");

const swCacheMatch = swJs.match(/CACHE_NAME\s*=\s*"([^"]+)"/);
assert(!!swCacheMatch, "CACHE_NAME defined");
if (swCacheMatch) {
  const version = swCacheMatch[1];
  console.log(`     Cache name: ${version}`);
  // Must be v3+ to bust the stale v2 cache
  const versionNum = parseInt(version.match(/v(\d+)/)?.[1] || "0", 10);
  assert(versionNum >= 3, `Cache version is v3+ (got v${versionNum}) to bust stale cache`);
}

// SW must cache styles.css
assert(swJs.includes("styles.css"), "SW caches styles.css");
assert(swJs.includes("src/main.js"), "SW caches src/main.js");

// ─── 6. CSS specificity sanity ──────────────────────────────────
console.log("\n6. CSS specificity");

// .view.hidden uses !important — verify .print-ready.printing also uses !important
assert(css.includes(".view.hidden, .hidden { display: none !important; }"),
  ".hidden uses display: none !important (baseline)");
// The print rule must also use !important to override .hidden
assert(
  mediaPrintMatch && mediaPrintMatch[1].includes("display: block !important"),
  "@media print .printing uses !important (overrides .hidden)"
);

// ─── Summary ─────────────────────────────────────────────────────
console.log(`\n${"=".repeat(50)}`);
if (failures === 0) {
  console.log("ALL CHECKS PASSED ✓");
} else {
  console.log(`${failures} CHECK(S) FAILED ✗`);
}
process.exit(failures);
