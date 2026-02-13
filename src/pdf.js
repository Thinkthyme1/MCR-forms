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
  return lines.map(({ x, y, size = 11, text }) => `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escapePdfText(text)}) Tj ET`).join("\n");
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

export function buildFileName(formType, general) {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const a = (general.firstName || "X")[0]?.toUpperCase() || "X";
  const b = (general.lastName || "X")[0]?.toUpperCase() || "X";
  return `${mm}.${dd}.${yy} ${a}${b} ${formType}.pdf`;
}

export async function createRoiPdf(state, roi, legalText) {
  const subtitleLines = [
    `Client: ${state.general.firstName} ${state.general.lastName}`.trim(),
    `DOB: ${state.general.dob || ""}`,
    `Staff: ${state.staff.firstName} ${state.staff.lastName}`.trim(),
    `Purpose: ${roi.purpose || ""}`,
    `Agency: ${roi.organization || ""}`
  ];
  const bodySections = [
    { heading: "Legal Text", text: legalText },
    { heading: "Summary", text: roi.summary || "" },
    { heading: "Notes", text: roi.notes || "" }
  ];
  return buildPdf({
    title: "Release of Information",
    subtitleLines,
    bodySections,
    signatureDataUrl: roi.signature,
    signedDate: roi.date,
    signedTime: roi.time
  });
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
