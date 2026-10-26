// "COMPOSITE REPORT" PDF (Incoming Approval Slip, Rice Unit) — the exposed-sample
// analysis from the lab test next to the composite-sample analysis.
// Pure drawing: the controller hands over already-resolved data.
// Same visual language as the Lab Test Report and the Material Inward / Outward slips.

const { ui } = require("./materialSlipPdf.helper");
const { C, M, L, W, SIG_Y, safe, text, isBlank, drawHeader, drawMeta, drawSection, drawKv, drawSignatures, drawFooter } = ui;

const RESULT = {
  approved: { label: "APPROVED", color: C.ok, tint: "#e8f5e9" },
  rejected: { label: "REJECTED", color: C.bad, tint: "#fdecec" },
  non_conforming: { label: "NON CONFORMING", color: C.warn, tint: "#fff3e0" },
};
const RESULT_OPTIONS = Object.entries(RESULT).map(([key, r]) => ({ key, label: r.label }));
const DEFAULT_ACCENT = "#3b5b92";

const pad2 = (n) => String(n).padStart(2, "0");
const fmtDate = (v) => {
  if (!v) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? "" : `${pad2(t.getDate())}-${pad2(t.getMonth() + 1)}-${t.getFullYear()}`;
};

// d: { plant, report_no, approval_no, ref_no, date, party, truck, qty, quality,
//      params: [{ name, exposed, composite }], result_exposed, result_composite,
//      remarks, generated_by }
const drawCompositeReport = (doc, d) => {
  // Start a new page when the next block would run into the signature line.
  const ensure = (y, h) => {
    if (y + h <= SIG_Y - 8) return y;
    doc.addPage();
    return M + 4;
  };

  const accent = (RESULT[d.result_composite] || RESULT[d.result_exposed] || {}).color || DEFAULT_ACCENT;
  let y = drawHeader(doc, d.plant, "COMPOSITE REPORT", accent);

  y = drawMeta(doc, y, [
    { label: "Report No.", value: d.report_no },
    { label: "Approval No.", value: d.approval_no },
    { label: "Ref / Sample No.", value: d.ref_no },
    { label: "Date", value: fmtDate(d.date) },
  ]);

  // ---- consignment
  y = drawSection(doc, y, "Party & Consignment Details", accent);
  y = drawKv(doc, y, [
    [{ l: "Party Name", v: d.party, bold: true }],
    [{ l: "Truck No.", v: d.truck }, { l: "Qty", v: d.qty }],
    [{ l: "Quality", v: d.quality, bold: true }],
  ]);
  y += 4;

  // ---- sample analysis table
  y = ensure(y, 19 + 24 + 18);
  y = drawSection(doc, y, "Sample Analysis", accent);

  const params = (d.params || []).filter((p) => p && !isBlank(p.name));
  const cw = [34, W - 34 - 2 * 150, 150, 150];
  const xs = [L, L + cw[0], L + cw[0] + cw[1], L + cw[0] + cw[1] + cw[2]];
  const headH = 24;
  const rowH = 17;

  const tableHead = (ty) => {
    doc.save().rect(L, ty, W, headH).fill(C.headFill).restore();
    doc.save().lineWidth(0.6).strokeColor(C.line).rect(L, ty, W, headH).stroke().restore();
    const heads = [
      { t: "S.No", align: "center" },
      { t: "Specification", align: "left" },
      { t: "Exposed Sample Analysis", align: "center" },
      { t: "Composite Sample Analysis", align: "center" },
    ];
    heads.forEach((h, i) => {
      text(doc, h.t.toUpperCase(), xs[i] + (h.align === "left" ? 10 : 0), ty + 9, {
        size: 6.8, bold: true, color: C.navy, spacing: 0.4, width: cw[i] - (h.align === "left" ? 14 : 0), align: h.align,
      });
    });
    return ty + headH;
  };

  y = tableHead(y);
  if (params.length === 0) {
    doc.save().lineWidth(0.5).strokeColor(C.line).rect(L, y, W, rowH + 4).stroke().restore();
    text(doc, "No parameters recorded.", L + 10, y + 7, { size: 8.6, italic: true, color: C.muted });
    y += rowH + 4;
  }
  params.forEach((p, i) => {
    if (y + rowH > SIG_Y - 8) {
      doc.addPage();
      y = tableHead(M + 4);
    }
    if (i % 2 === 1) doc.save().rect(L, y, W, rowH).fill(C.zebra).restore();
    doc.save().lineWidth(0.4).strokeColor(C.line);
    doc.moveTo(L, y + rowH).lineTo(L + W, y + rowH).stroke();
    doc.moveTo(L, y).lineTo(L, y + rowH).stroke();
    doc.moveTo(L + W, y).lineTo(L + W, y + rowH).stroke();
    xs.slice(1).forEach((x) => doc.moveTo(x, y).lineTo(x, y + rowH).stroke());
    doc.restore();

    const ty = y + 4.8;
    text(doc, String(i + 1), xs[0], ty, { size: 8, color: C.muted, width: cw[0], align: "center" });
    text(doc, p.name, xs[1] + 10, ty, { size: 8.6, bold: true, width: cw[1] - 14 });
    if (isBlank(p.exposed)) text(doc, "—", xs[2], ty, { size: 8.8, color: C.muted, width: cw[2], align: "center" });
    else text(doc, p.exposed, xs[2], ty, { size: 8.8, width: cw[2], align: "center" });
    if (isBlank(p.composite)) text(doc, "—", xs[3], ty, { size: 8.8, color: C.muted, width: cw[3], align: "center" });
    else text(doc, p.composite, xs[3], ty, { size: 8.8, bold: true, color: accent, width: cw[3], align: "center" });
    y += rowH;
  });
  y += 14;

  // ---- results (two panels, like the Lab Test verdict block)
  y = ensure(y, 19 + 52 + 12 + 19 + 56 + 12);
  y = drawSection(doc, y, "Results", accent);
  const gap = 10;
  const pw = (W - gap) / 2;
  const ph = 52;
  [
    { title: "Exposed Bag Sample", key: d.result_exposed },
    { title: "Composite Bag Sample", key: d.result_composite },
  ].forEach((panel, i) => {
    const x = L + i * (pw + gap);
    const r = RESULT[panel.key];
    doc.save().roundedRect(x, y, pw, ph, 4).fill(r ? r.tint : C.panel).restore();
    if (!r) doc.save().roundedRect(x, y, pw, ph, 4).lineWidth(0.6).strokeColor(C.line).stroke().restore();
    doc.save().rect(x, y, 6, ph).fill(r ? r.color : C.line).restore();
    text(doc, panel.title.toUpperCase(), x + 18, y + 9, { size: 6.8, bold: true, color: C.muted, spacing: 0.5, width: pw - 28 });
    if (r) text(doc, r.label, x + 18, y + 24, { size: 16, bold: true, color: r.color, width: pw - 28 });
    else text(doc, "Not set", x + 18, y + 26, { size: 11, italic: true, color: C.muted });
  });
  y += ph + 12;

  // ---- remarks
  y = drawSection(doc, y, "Remarks", accent);
  const rh = 56;
  doc.save().lineWidth(0.6).strokeColor(C.line).rect(L, y, W, rh).stroke().restore();
  if (isBlank(d.remarks)) {
    text(doc, "No remarks recorded.", L + 10, y + 10, { size: 8.6, italic: true, color: C.muted });
  } else {
    doc.font("Helvetica").fontSize(8.8).fillColor(C.ink).text(safe(d.remarks), L + 10, y + 9, { width: W - 20, height: rh - 16, ellipsis: true });
  }

  drawSignatures(doc, ["Prepared By", "Quality Incharge", "Auth. Signatory"]);
  drawFooter(
    doc,
    `Composite Report  |  ${d.report_no || ""}  |  ${d.ref_no || ""}${d.generated_by ? `  |  ${d.generated_by}` : ""}`,
    "report",
  );
};

module.exports = { drawCompositeReport, RESULT_OPTIONS };