// "INWARD / OUTWARD GATE PASS" — the item-table style pass used for Purchase
// (inward) and Sales (outward) trucks. Two copies only — ORIGINAL and
// ACCOUNTS — stacked on one A4 page (or one per page when the item table is
// too long to fit half a page). Empty/Misc trucks use the simpler store pass
// in gatePassPdf.helper.js instead.
//
// Pure drawing code: it receives already-resolved data (see
// controllers/gatePass.controller.js) and writes onto a pdfkit document.
// No database access happens here.

const QRCode = require("qrcode");

const NAVY = "#1f2a44";
const BODY = "#33363d";
const RULE = "#b8bec8";
const HEAD_BG = "#eef1f5";

// pdfkit's built-in fonts only cover Latin text, so anything else (Hindi
// item names, the rupee sign...) would print as garbage. Swap the rupee sign
// for "Rs" and any other unsupported character for "?".
const safe = (v) =>
  String(v ?? "")
    .replace(/\u20B9/g, "Rs ")
    .replace(/[^\x20-\x7E\xA0-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026]/g, "?");

const fitText = (doc, text, maxW) => {
  let t = safe(text);
  if (maxW <= 0) return "";
  if (doc.widthOfString(t) <= maxW) return t;
  while (t.length > 1 && doc.widthOfString(`${t}...`) > maxW) t = t.slice(0, -1);
  return `${t}...`;
};

// Draws a QR code as vector squares (no image file / async step needed).
const drawQr = (doc, text, x, y, size) => {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const bits = qr.modules.data;
  const cell = size / n;
  doc.save().fillColor("#000");
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (bits[r * n + c]) doc.rect(x + c * cell, y + r * cell, cell + 0.2, cell + 0.2);
    }
  }
  doc.fill().restore();
};

// ---- layout constants (points) ----
const PAD = 14;
const FIELDS_TOP = 76;
const FIELD_PITCH = 15;
const TABLE_TOP = FIELDS_TOP + 4 * FIELD_PITCH + 6;
const HEAD_H = 16;
const ROW_H = 14;
const SIGN_RESERVED = 52; // space kept free at the bottom for signatures

const COLS = [
  { key: "item_name", label: "Item Name", f: 0.3, align: "left" },
  { key: "lab_decision", label: "Lab Decision", f: 0.14, align: "left", bold: true },
  { key: "size", label: "Size", f: 0.08, align: "center" },
  { key: "total", label: "Total", f: 0.08, align: "center" },
  { key: "accp", label: "Accp", f: 0.08, align: "center" },
  { key: "rej", label: "Rej", f: 0.08, align: "center" },
  { key: "remarks", label: "Remarks", f: 0.24, align: "left" },
];

const rowCapacity = (h) => Math.max(1, Math.floor((h - TABLE_TOP - HEAD_H - SIGN_RESERVED) / ROW_H));

const drawPass = (doc, { x, y, w, h }, copyLabel, d) => {
  const innerL = x + PAD;
  const innerR = x + w - PAD;
  const innerW = innerR - innerL;

  doc.save().lineWidth(1).strokeColor("#222").rect(x, y, w, h).stroke().restore();

  // ---- letterhead ----
  const qrSize = 52;
  const textMaxW = innerW - qrSize - 90;
  doc.font("Helvetica-Bold").fontSize(15).fillColor(NAVY);
  doc.text(fitText(doc, d.plant_name, textMaxW), innerL, y + 12, { lineBreak: false });
  doc.font("Helvetica").fontSize(7).fillColor(BODY);
  doc.text(fitText(doc, d.plant_address, textMaxW), innerL, y + 31, { lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(NAVY);
  doc.text(safe(d.title), innerL, y + 45, { lineBreak: false });

  drawQr(doc, d.qr_text, innerR - qrSize, y + 10, qrSize);

  const lw = 62, lh = 16;
  const lx = innerR - qrSize - 10 - lw;
  doc.save().lineWidth(1).strokeColor("#111").rect(lx, y + 12, lw, lh).stroke().restore();
  doc.font("Helvetica-Bold").fontSize(7.4).fillColor("#111");
  doc.text(copyLabel, lx, y + 17.4, { width: lw, align: "center", lineBreak: false });

  doc.save().lineWidth(1.6).strokeColor(NAVY).moveTo(innerL, y + 68).lineTo(innerR, y + 68).stroke().restore();

  // ---- header fields (2 columns x 4 rows) ----
  const colL = innerL;
  const colR = x + w * 0.5 + 4;
  const colLW = colR - colL - 10;
  const colRW = innerR - colR;

  const field = (label, value, colX, rowIdx, maxW) => {
    const fy = y + FIELDS_TOP + rowIdx * FIELD_PITCH;
    doc.font("Helvetica-Bold").fontSize(7.8).fillColor(NAVY);
    const lbl = `${label}:`;
    doc.text(lbl, colX, fy, { lineBreak: false });
    const vx = colX + doc.widthOfString(lbl) + 4;
    doc.font("Helvetica").fontSize(7.8).fillColor(BODY);
    doc.text(fitText(doc, value, maxW - (vx - colX)), vx, fy, { lineBreak: false });
  };

  field("GP No", d.gp_no, colL, 0, colLW);
  field("Date", d.date_time, colR, 0, colRW);
  field("Vehicle", d.vehicle_no, colL, 1, colLW);
  field("Driver", d.driver_name, colR, 1, colRW);
  field("Party", d.party_name, colL, 2, colLW);
  field("PO / SO No", d.po_so_no, colL, 3, colLW);
  field("Challan / Inv No", d.inv_no, colR, 3, colRW);

  // Net weight: the number if the weighbridge has one, else a blank line to
  // write on by hand (same as the paper pass).
  {
    const fy = y + FIELDS_TOP + 2 * FIELD_PITCH;
    doc.font("Helvetica-Bold").fontSize(7.8).fillColor(NAVY);
    doc.text("Net Weight:", colR, fy, { lineBreak: false });
    const nx = colR + doc.widthOfString("Net Weight:") + 4;
    if (d.net_weight) {
      doc.font("Helvetica-Bold").fontSize(7.8).fillColor(BODY);
      doc.text(safe(d.net_weight), nx, fy, { lineBreak: false });
      const vw = doc.widthOfString(safe(d.net_weight));
      doc.font("Helvetica-Bold").fontSize(7.8).fillColor(NAVY);
      doc.text("KG", nx + vw + 4, fy, { lineBreak: false });
    } else {
      doc.save().lineWidth(0.7).strokeColor("#555").moveTo(nx, fy + 8).lineTo(nx + 80, fy + 8).stroke().restore();
      doc.font("Helvetica-Bold").fontSize(7.8).fillColor(NAVY);
      doc.text("KG", nx + 86, fy, { lineBreak: false });
    }
  }

  // ---- item table ----
  const widths = COLS.map((c) => c.f * innerW);
  const xs = [];
  widths.reduce((acc, cw, i) => ((xs[i] = acc), acc + cw), innerL);

  const cap = rowCapacity(h);
  let rows = d.items || [];
  if (rows.length > cap) {
    const hidden = rows.length - (cap - 1);
    rows = [
      ...rows.slice(0, cap - 1),
      { item_name: `... and ${hidden} more item(s)`, lab_decision: "", size: "", total: "", accp: "", rej: "", remarks: "see records" },
    ];
  }

  const tableTop = y + TABLE_TOP;
  doc.save().fillColor(HEAD_BG).rect(innerL, tableTop, innerW, HEAD_H).fill().restore();
  doc.font("Helvetica-Bold").fontSize(7.6).fillColor(NAVY);
  COLS.forEach((c, i) => {
    doc.text(c.label, xs[i] + 4, tableTop + 4.5, { width: widths[i] - 8, align: c.align, lineBreak: false });
  });

  rows.forEach((r, ri) => {
    const ry = tableTop + HEAD_H + ri * ROW_H;
    COLS.forEach((c, i) => {
      const raw = r[c.key];
      const val = raw === null || raw === undefined || raw === "" ? "" : raw;
      doc.font(c.bold ? "Helvetica-Bold" : "Helvetica").fontSize(7.4).fillColor(BODY);
      doc.text(fitText(doc, val, widths[i] - 8), xs[i] + 4, ry + 3.6, { width: widths[i] - 8, align: c.align, lineBreak: false });
    });
  });

  const tableH = HEAD_H + rows.length * ROW_H;
  doc.save().lineWidth(0.7).strokeColor("#555");
  doc.rect(innerL, tableTop, innerW, tableH).stroke();
  for (let i = 1; i < COLS.length; i++) doc.moveTo(xs[i], tableTop).lineTo(xs[i], tableTop + tableH).stroke();
  doc.moveTo(innerL, tableTop + HEAD_H).lineTo(innerR, tableTop + HEAD_H).stroke();
  doc.strokeColor(RULE).lineWidth(0.4);
  for (let i = 1; i < rows.length; i++) {
    const ly = tableTop + HEAD_H + i * ROW_H;
    doc.moveTo(innerL, ly).lineTo(innerR, ly).stroke();
  }
  doc.restore();

  // ---- signatures ----
  const sy = y + h - 24;
  const sigs = [
    { text: "HOD Signature", sx: innerL, align: "left" },
    { text: "Driver Signature", sx: x + w / 2, align: "center" },
    { text: "Security Exit Sign", sx: innerR, align: "right" },
  ];
  const lineLen = 96;
  sigs.forEach((s) => {
    doc.font("Helvetica-Bold").fontSize(7.6).fillColor(NAVY);
    const tw = doc.widthOfString(s.text);
    const tx = s.align === "left" ? s.sx : s.align === "center" ? s.sx - tw / 2 : s.sx - tw;
    const lx2 = s.align === "left" ? s.sx : s.align === "center" ? s.sx - lineLen / 2 : s.sx - lineLen;
    doc.save().lineWidth(0.8).strokeColor("#8a909a").moveTo(lx2, sy - 4).lineTo(lx2 + lineLen, sy - 4).stroke().restore();
    doc.font("Helvetica-Bold").fontSize(7.6).fillColor(NAVY).text(s.text, tx, sy, { lineBreak: false });
  });
};

// Draws the two copies onto `doc` (a fresh A4 pdfkit document, margin 0).
const drawGatePassModule = (doc, data) => {
  const margin = 29;
  const gap = 12;
  const w = doc.page.width - margin * 2;
  const halfH = (doc.page.height - margin * 2 - gap) / 2;
  const itemCount = (data.items || []).length;

  if (itemCount <= rowCapacity(halfH)) {
    // Both copies fit on one sheet, with a cut line between them.
    drawPass(doc, { x: margin, y: margin, w, h: halfH }, "ORIGINAL", data);
    drawPass(doc, { x: margin, y: margin + halfH + gap, w, h: halfH }, "ACCOUNTS", data);
    const cy = margin + halfH + gap / 2;
    doc.save().lineWidth(0.7).strokeColor("#666").dash(3, { space: 3 }).moveTo(margin, cy).lineTo(margin + w, cy).stroke().undash().restore();
    doc.save().fillColor("#fff").rect(margin + w / 2 - 28, cy - 4.5, 56, 9).fill().restore();
    doc.font("Helvetica").fontSize(6.5).fillColor("#666").text("CUT LINE", margin + w / 2 - 28, cy - 2.6, { width: 56, align: "center", lineBreak: false });
  } else {
    // A long item list: one copy per page so nothing gets cut off.
    const fullH = doc.page.height - margin * 2;
    drawPass(doc, { x: margin, y: margin, w, h: fullH }, "ORIGINAL", data);
    doc.addPage({ size: "A4", margin: 0 });
    drawPass(doc, { x: margin, y: margin, w, h: fullH }, "ACCOUNTS", data);
  }
};

module.exports = { drawGatePassModule };