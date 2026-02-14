function escapePdfText(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r?\n/g, " ");
}

function wrapText(text, maxChars = 92) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (trial.length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines;
}

class PdfDoc {
  constructor() {
    this.objects = [];
  }

  addObject(content) {
    this.objects.push(content);
    return this.objects.length;
  }

  finalize(rootObjId) {
    const parts = [asciiBytes("%PDF-1.4\n")];
    const offsets = [0];
    let total = parts[0].length;

    for (let i = 0; i < this.objects.length; i += 1) {
      offsets.push(total);
      const obj = this.objects[i];
      const open = asciiBytes(`${i + 1} 0 obj\n`);
      const close = asciiBytes("\nendobj\n");
      const body = typeof obj === "string" ? asciiBytes(obj) : obj;
      const all = concatBytes([open, body, close]);
      parts.push(all);
      total += all.length;
    }

    const xrefOffset = total;
    parts.push(asciiBytes(`xref\n0 ${this.objects.length + 1}\n`));
    parts.push(asciiBytes("0000000000 65535 f \n"));
    for (let i = 1; i <= this.objects.length; i += 1) {
      parts.push(asciiBytes(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`));
    }

    parts.push(asciiBytes(`trailer\n<< /Size ${this.objects.length + 1} /Root ${rootObjId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
    return concatBytes(parts);
  }
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function asciiBytes(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function signatureToJpeg(dataUrl) {
  if (!dataUrl) return null;
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const jpegUrl = canvas.toDataURL("image/jpeg", 0.9);
  return { bytes: dataUrlToBytes(jpegUrl), width: canvas.width, height: canvas.height };
}

function buildTextOps(lines) {
  return lines.map(({ x, y, size = 11, text, bold }) => {
    const font = bold ? "/F2" : "/F1";
    return `BT ${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escapePdfText(text)}) Tj ET`;
  }).join("\n");
}

async function buildPdf({ title, subtitleLines, bodySections, signatureDataUrl, signedDate, signedTime }) {
  const doc = new PdfDoc();
  const pageW = 612;
  const pageH = 792;

  const fontObj = doc.addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const textLines = [{ x: 42, y: 760, size: 16, text: title }];
  let y = 742;
  for (const line of subtitleLines) {
    textLines.push({ x: 42, y, size: 11, text: line });
    y -= 16;
  }

  y -= 4;
  for (const section of bodySections) {
    textLines.push({ x: 42, y, size: 12, text: section.heading });
    y -= 15;
    const wrapped = wrapText(section.text, 94);
    for (const ln of wrapped) {
      if (y < 110) break;
      textLines.push({ x: 42, y, size: 10, text: ln });
      y -= 13;
    }
    y -= 6;
  }

  const signature = await signatureToJpeg(signatureDataUrl);
  let imageObjId = null;
  let imageOp = "";

  if (signature) {
    const imgHeader = asciiBytes(
      `<< /Type /XObject /Subtype /Image /Width ${signature.width} /Height ${signature.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${signature.bytes.length} >>\nstream\n`
    );
    imageObjId = doc.addObject(concatBytes([imgHeader, signature.bytes, asciiBytes("\nendstream")]));

    const sigW = 260;
    const sigH = 74;
    const sigX = 42;
    const sigY = 44;
    imageOp = `q ${sigW} 0 0 ${sigH} ${sigX} ${sigY} cm /SigImg Do Q`;
  }

  textLines.push({ x: 42, y: 92, size: 10, text: "Client Signature:" });
  textLines.push({ x: 320, y: 92, size: 10, text: `Date: ${signedDate || ""}` });
  textLines.push({ x: 320, y: 76, size: 10, text: `Time: ${signedTime || ""}` });

  const contentText = buildTextOps(textLines);
  const resources = imageObjId
    ? `<< /Font << /F1 ${fontObj} 0 R >> /XObject << /SigImg ${imageObjId} 0 R >> >>`
    : `<< /Font << /F1 ${fontObj} 0 R >> >>`;

  const contentStream = `${contentText}\n${imageOp}`;
  const contentObj = doc.addObject(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`);
  const pageObj = doc.addObject(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources ${resources} /Contents ${contentObj} 0 R >>`);
  const pagesObj = doc.addObject(`<< /Type /Pages /Kids [${pageObj} 0 R] /Count 1 >>`);

  doc.objects[pageObj - 1] = doc.objects[pageObj - 1].replace("/Parent 0 0 R", `/Parent ${pagesObj} 0 R`);

  const catalogObj = doc.addObject(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);

  return doc.finalize(catalogObj);
}

function checkMark(value) {
  return value ? "X" : " ";
}

async function buildRoiPdf(state, roi) {
  const doc = new PdfDoc();
  const pageW = 612;
  const pageH = 792;
  const margin = 36;
  const contentW = pageW - margin * 2;
  const leftColW = 250;

  const fontObj = doc.addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const boldFontObj = doc.addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  /* ---- multi-page content collectors ---- */
  const pages = [{ textLines: [], drawOps: [] }];
  let pi = 0;
  let y = pageH - margin;

  function push(x, yp, text, size, bold) {
    pages[pi].textLines.push({ x, y: yp, size: size || 10, text: String(text || ""), bold: !!bold });
  }
  function draw(op) { pages[pi].drawOps.push(op); }
  function newPage() {
    pi++;
    pages.push({ textLines: [], drawOps: [] });
    y = pageH - margin;
  }
  function ensureSpace(needed) {
    if (y - needed < margin) newPage();
  }

  /* ---- 1. Title (16pt bold, centered) ---- */
  push(190, y, "Release of Information", 16, true);
  y -= 22;

  /* ---- 2. Client info ---- */
  const clientName = `${(state.general.firstName || "").trim()} ${(state.general.lastName || "").trim()}`.trim();
  push(margin, y, `Client: ${clientName}`, 10);
  push(330, y, `DOB: ${state.general.dob || ""}`, 10);
  y -= 16;

  /* ---- 3. Authorization header (10pt bold, centered) ---- */
  push(95, y, "AUTHORIZATION FOR RELEASE OF INFORMATION \u2013 STANDARD REQUEST", 10, true);
  y -= 18;

  /* ---- 4. Routing box (bordered, equal-height columns) ---- */
  const routeH = 110;
  ensureSpace(routeH);
  const routeTop = y;
  const routeBot = routeTop - routeH;
  draw(`${margin} ${routeBot} ${contentW} ${routeH} re S`);
  draw(`${margin + leftColW} ${routeBot} m ${margin + leftColW} ${routeTop} l S`);

  push(margin + 10, routeTop - 16, `[${checkMark(roi.leftTo !== false)}] To`, 10);
  push(margin + 10, routeTop - 32, `[${checkMark(roi.leftFrom !== false)}] From`, 10);
  push(margin + 10, routeTop - 50, "Benchmark Human Services", 10, true);
  push(margin + 10, routeTop - 64, "530 West Thomas Street, Suite C", 9);
  push(margin + 10, routeTop - 78, "Milledgeville, GA 31061", 9);
  push(margin + 10, routeTop - 92, "(478) 451-0557", 9);

  const rx = margin + leftColW + 10;
  push(rx, routeTop - 16, `[${checkMark(roi.rightTo !== false)}] To`, 10);
  push(rx + 80, routeTop - 16, `[${checkMark(roi.rightFrom !== false)}] From`, 10);
  push(rx, routeTop - 34, `Agency: ${roi.organization || ""}`, 9);
  push(rx, routeTop - 48, `C/O: ${roi.careOf || ""}`, 9);
  const addrLines = wrapText(`Address: ${roi.address || ""}`, 48).slice(0, 2);
  for (const [i, line] of addrLines.entries()) {
    push(rx, routeTop - 62 - i * 12, line, 9);
  }
  push(rx, routeTop - 88, `Phone: ${roi.phone || ""}`, 9);
  push(rx + 120, routeTop - 88, `Fax: ${roi.fax || ""}`, 9);

  y = routeBot - 12;

  /* ---- 5. Initials section (bordered boxes) ---- */
  ensureSpace(60);
  push(margin + 10, y, "Initial the appropriate space below:", 10, true);
  y -= 20;

  draw(`${margin + 10} ${y} 20 16 re S`);
  push(margin + 15, y + 4, (roi.init1a || "").toUpperCase().slice(0, 4), 9);
  push(margin + 38, y + 4, "I authorize disclosure of alcohol or drug abuse information.", 9);
  y -= 24;

  draw(`${margin + 10} ${y} 20 16 re S`);
  push(margin + 15, y + 4, (roi.init2a || "").toUpperCase().slice(0, 4), 9);
  push(margin + 38, y + 4, "I authorize disclosure of HIV/AIDS testing/treatment information.", 9);
  y -= 24;

  /* ---- 6. Purpose of disclosure ---- */
  ensureSpace(16);
  push(margin + 10, y, "Purpose of Disclosure:", 10, true);
  push(margin + 155, y, roi.purpose || "", 10);
  y -= 18;

  /* ---- 7. Duration ---- */
  push(margin + 10, y, "Duration (check one):", 9, true);
  push(margin + 130, y, `[${checkMark(roi.durationChoice === "oneYear")}] one (1) year`, 9);
  push(margin + 280, y, `[${checkMark(roi.durationChoice !== "oneYear")}] service period`, 9);
  y -= 18;

  /* ---- 8. Legal paragraphs (9pt, 12pt line spacing) ---- */
  const legalParagraphs = [
    "1. I understand that the information disclosed pursuant to this Authorization may be subject to re-disclosure by the recipient and no longer protected by federal privacy regulations or other applicable state or federal laws (except as set forth in paragraph 2 below).",
    "2. I understand that, pursuant to 42 C.F.R. Part 2, substance use disorder records disclosed under this Authorization are subject to federal confidentiality protections. Depending on the recipient, these records may be re-disclosed in accordance with the HIPAA Privacy Rule or may require my written consent for any further re-disclosure. These records may not be used in any civil, criminal, administrative, or legislative proceeding against me without my specific written consent or a court order. Violations may result in civil and criminal penalties under federal law.",
    "3. I understand that the Department of Behavioral Health and Developmental Disabilities will not condition my treatment, payment, or eligibility for any applicable benefits on whether I provide authorization for the requested release of information.",
    "4. I intend this document to be a valid authorization conforming to all requirements of the Privacy Rule and State law, and understand that my authorization will remain in effect for: (PLEASE CHECK ONE)"
  ];
  for (const para of legalParagraphs) {
    const lines = wrapText(para, 100);
    ensureSpace(lines.length * 12 + 6);
    for (const line of lines) {
      push(margin + 10, y, line, 9);
      y -= 12;
    }
    y -= 4;
  }

  /* ---- 9. Horizontal rule separator ---- */
  y -= 4;
  draw(`q 0.5 w ${margin} ${y} m ${margin + contentW} ${y} l S Q`);
  y -= 12;

  /* ---- 10. Signature blocks (bordered, image left, text right) ---- */
  const sigImgW = 150;
  const sigImgH = 50;
  const sigRectH = 56;
  const sigDivX = margin + sigImgW + 20;
  const sigEntries = [];
  const date = roi.date || "";

  const sigConfigs = [
    { label: "Client Signature", name: clientName, dataUrl: roi.signature, key: "SigClient" },
    { label: "Parent/Representative Signature", name: roi.parentPrintedName || "", dataUrl: roi.parentSignature || "", key: "SigParent" }
  ];

  for (const sig of sigConfigs) {
    ensureSpace(sigRectH + 18);
    push(margin, y, sig.label, 10, true);
    y -= 14;
    draw(`${margin} ${y - sigRectH} ${contentW} ${sigRectH} re S`);
    draw(`${sigDivX} ${y - sigRectH} m ${sigDivX} ${y} l S`);
    push(sigDivX + 10, y - 22, `Name: ${sig.name}`, 9);
    push(sigDivX + 10, y - 38, `Date: ${date}`, 9);
    sigEntries.push({ key: sig.key, dataUrl: sig.dataUrl, x: margin + 5, y: y - sigRectH + 3, page: pi });
    y -= sigRectH + 8;
  }

  /* ---- Build signature JPEG images ---- */
  const xObjectEntries = [];
  const pageImageOps = {};
  for (const entry of sigEntries) {
    const sig = await signatureToJpeg(entry.dataUrl);
    if (!sig) continue;
    const imgHeader = asciiBytes(
      `<< /Type /XObject /Subtype /Image /Width ${sig.width} /Height ${sig.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${sig.bytes.length} >>\nstream\n`
    );
    const imgObjId = doc.addObject(concatBytes([imgHeader, sig.bytes, asciiBytes("\nendstream")]));
    xObjectEntries.push(`/${entry.key} ${imgObjId} 0 R`);
    if (!pageImageOps[entry.page]) pageImageOps[entry.page] = [];
    pageImageOps[entry.page].push(`q ${sigImgW} 0 0 ${sigImgH} ${entry.x} ${entry.y} cm /${entry.key} Do Q`);
  }

  /* ---- Assemble PDF pages ---- */
  const xObjPart = xObjectEntries.length ? ` /XObject << ${xObjectEntries.join(" ")} >>` : "";
  const resources = `<< /Font << /F1 ${fontObj} 0 R /F2 ${boldFontObj} 0 R >>${xObjPart} >>`;

  const pageObjIds = [];
  for (let p = 0; p <= pi; p++) {
    const pg = pages[p];
    const textOps = buildTextOps(pg.textLines);
    const imgOps = (pageImageOps[p] || []).join("\n");
    const stream = `${pg.drawOps.join("\n")}\n${textOps}\n${imgOps}`;
    const contentObj = doc.addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageObjId = doc.addObject(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources ${resources} /Contents ${contentObj} 0 R >>`);
    pageObjIds.push(pageObjId);
  }

  const kids = pageObjIds.map(id => `${id} 0 R`).join(" ");
  const pagesObj = doc.addObject(`<< /Type /Pages /Kids [${kids}] /Count ${pageObjIds.length} >>`);
  for (const id of pageObjIds) {
    doc.objects[id - 1] = doc.objects[id - 1].replace("/Parent 0 0 R", `/Parent ${pagesObj} 0 R`);
  }
  const catalogObj = doc.addObject(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  return doc.finalize(catalogObj);
}

export function buildFileName(formType, general) {
  const d = new Date();
  const m = String(d.getMonth() + 1);
  const day = String(d.getDate());
  const yy = String(d.getFullYear()).slice(-2);
  const a = (general.firstName || "X")[0]?.toUpperCase() || "X";
  const b = (general.lastName || "X")[0]?.toUpperCase() || "X";
  return `${a}${b} ${m}.${day}.${yy} ${formType}.pdf`;
}

export async function createRoiPdf(state, roi) {
  return buildRoiPdf(state, roi);
}

export async function createNoticePdf(state, legalSections) {
  const subtitleLines = [
    `Client: ${state.general.firstName} ${state.general.lastName}`.trim(),
    `DOB: ${state.general.dob || ""}`,
    `Staff: ${state.staff.firstName} ${state.staff.lastName}`.trim()
  ];
  const bodySections = [
    { heading: "Section 1", text: `${legalSections[0].title}: ${state.notice.summary1}\n${legalSections[0].text}` },
    { heading: "Section 2", text: `${legalSections[1].title}: ${state.notice.summary2}\n${legalSections[1].text}` },
    { heading: "Section 3", text: `${legalSections[2].title}: ${state.notice.summary3}\n${legalSections[2].text}` }
  ];
  return buildPdf({
    title: "Notice of Privacy Practices",
    subtitleLines,
    bodySections,
    signatureDataUrl: state.notice.signature,
    signedDate: state.notice.date,
    signedTime: state.notice.time
  });
}
