// "INWARD STORE PASS" gate pass — drawn to match the store's existing gate
// pass sheet (dotted box, bold "RD" + title, boxed copy label top-right,
// two-column field list with thin separators, three signature lines).
// Two passes per A4 page: ORIGINAL and ACCOUNTS (no SECURITY copy).

const NAVY = "#1f2a44";
const BODY = "#33363d";
const RULE = "#e3e5e8";

// pdfkit's built-in fonts have no Indian-rupee glyph, so draw the sign as a
// small vector (two bars + bowl + diagonal leg). Returns the width it used.
const drawRupee = (doc, x, baseline, size) => {
  const ch = size * 0.72;
  const w = size * 0.5;
  const top = baseline - ch;
  doc.save().lineWidth(size * 0.085).strokeColor(BODY).lineCap("butt").lineJoin("round");
  doc.moveTo(x, top + ch * 0.04).lineTo(x + w, top + ch * 0.04).stroke();
  doc.moveTo(x, top + ch * 0.27).lineTo(x + w, top + ch * 0.27).stroke();
  doc.moveTo(x + w * 0.1, top + ch * 0.04)
    .bezierCurveTo(x + w * 0.95, top + ch * 0.04, x + w * 0.95, top + ch * 0.55, x + w * 0.1, top + ch * 0.55)
    .lineTo(x + w * 0.25, top + ch * 0.55)
    .lineTo(x + w * 0.85, baseline)
    .stroke();
  doc.restore();
  return w + size * 0.12;
};

const fitText = (doc, text, maxW) => {
  let t = String(text ?? "");
  if (doc.widthOfString(t) <= maxW) return t;
  while (t.length > 1 && doc.widthOfString(`${t}...`) > maxW) t = t.slice(0, -1);
  return `${t}...`;
};

const drawPass = (doc, { x, y, w, h }, copyLabel, d) => {
  // dotted outer border
  doc.save().lineWidth(0.9).strokeColor("#555").dash(1.2, { space: 2.2 }).rect(x, y, w, h).stroke().undash().restore();

  const padX = 14;
  const innerL = x + padX;
  const innerR = x + w - padX;
  const innerW = innerR - innerL;
  const rightColX = x + w * 0.547;

  // header
  doc.font("Helvetica-Bold").fontSize(17).fillColor(NAVY).text("RD", x, y + 15, { width: w, align: "center", lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text("INWARD STORE PASS", x, y + 37, { width: w, align: "center", lineBreak: false });

  // boxed copy label (top-right)
  const lw = 54, lh = 17, lx = x + w - 12 - lw, ly = y + 12;
  doc.save().lineWidth(1).strokeColor("#111").rect(lx, ly, lw, lh).stroke().restore();
  doc.font("Helvetica-Bold").fontSize(7.2).fillColor("#111").text(copyLabel, lx, ly + 5.3, { width: lw, align: "center", lineBreak: false });

  // fields
  const rowY0 = y + 58;
  const pitch = 18;
  const field = (label, value, colX, rowIdx, maxW, rupee = false) => {
    const fy = rowY0 + rowIdx * pitch;
    doc.font("Helvetica-Bold").fontSize(7.6).fillColor(NAVY);
    const labelTxt = `${label}:`;
    doc.text(labelTxt, colX, fy, { lineBreak: false });
    let vx = colX + doc.widthOfString(labelTxt) + 3.5;
    const hasVal = value !== null && value !== undefined && String(value) !== "";
    if (rupee && hasVal) vx += drawRupee(doc.font("Helvetica").fontSize(7.6), vx, fy + 6.6, 7.6);
    doc.font("Helvetica").fontSize(7.6).fillColor(BODY);
    doc.text(fitText(doc, hasVal ? value : "", maxW - (vx - colX)), vx, fy, { lineBreak: false });
  };
  const colW = innerW / 2 - 8;

  field("GP NO", d.gp_no, innerL, 0, colW);
  field("DATE", d.date_time, rightColX, 0, innerR - rightColX);
  field("VEHICLE", d.vehicle_no, innerL, 1, colW);
  field("DRIVER", d.driver_name, rightColX, 1, innerR - rightColX);
  field("PARTY", d.party_name, innerL, 2, colW);
  field("INV NO", d.inv_no, rightColX, 2, innerR - rightColX);
  field("INV VALUE", d.inv_value, innerL, 3, colW, true);
  field("QTY", d.qty, rightColX, 3, innerR - rightColX);
  field("ITEMS", d.items, innerL, 4, innerW);
  field("REMARKS", d.remarks, innerL, 5, innerW);

  // thin separators under each field row except the last
  for (let i = 0; i < 5; i++) {
    const ly2 = rowY0 + i * pitch + 12.8;
    doc.save().lineWidth(0.5).strokeColor(RULE).moveTo(innerL, ly2).lineTo(innerR, ly2).stroke().restore();
  }

  // signature lines
  const sy = rowY0 + 6 * pitch + 22;
  const sigW = 66;
  const sigs = [
    { text: "Security Sign", lx: innerL },
    { text: "Driver Sign", lx: x + w * 0.445 },
    { text: "Authorized Sign", lx: innerR - sigW },
  ];
  sigs.forEach((s) => {
    doc.save().lineWidth(0.8).strokeColor("#9aa0a8").moveTo(s.lx, sy).lineTo(s.lx + sigW, sy).stroke().restore();
    doc.font("Helvetica-Bold").fontSize(7).fillColor(NAVY);
    const tw = doc.widthOfString(s.text);
    // Authorized Sign is right-aligned to the pass edge, like the original sheet.
    const tx = s.text === "Authorized Sign" ? innerR - tw : s.lx;
    doc.text(s.text, tx, sy + 5, { lineBreak: false });
  });
};

// Draws the two passes onto `doc` (a fresh A4 pdfkit document).
const drawGatePasses = (doc, data) => {
  const margin = 29;
  const w = doc.page.width - margin * 2;
  const h = 252;
  const gap = 10;
  drawPass(doc, { x: margin, y: margin, w, h }, "ORIGINAL", data);
  drawPass(doc, { x: margin, y: margin + h + gap, w, h }, "ACCOUNTS", data);
};

module.exports = { drawGatePasses };
