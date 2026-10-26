// "LAB TEST REPORT" PDF — one page per lab test (one test = one material of a
// sampling). Pure drawing: the controller hands over already-resolved data.
// Same visual language as the Material Inward / Outward slips.

const { ui } = require("./materialSlipPdf.helper");
const { C, M, L, W, SIG_Y, safe, text, isBlank, drawHeader, drawMeta, drawSection, drawKv, drawStats, drawSignatures, drawFooter } = ui;

const VERDICT = {
  accepted: { label: "ACCEPTED", color: C.ok, tint: "#e8f5e9", note: "Material accepted - the gate entry is released for weighment." },
  rejected: { label: "REJECTED", color: C.bad, tint: "#fdecec", note: "Material rejected - the load is stopped at the gate." },
  negotiation: { label: "NEGOTIATION", color: C.warn, tint: "#fff3e0", note: "Sent to Sales / Purchase for a rate discussion with the vendor." },
};

const pad2 = (n) => String(n).padStart(2, "0");
const fmtDT = (d) => {
  if (!d) return "—";
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? "—" : `${pad2(t.getDate())}-${pad2(t.getMonth() + 1)}-${t.getFullYear()} ${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
};
const pct = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v).toFixed(2));
const money = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? "—" : `Rs ${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

// d: { plant, test_no, sample_code, token_no, vehicle_no, party, party_label,
//      po_nos, challan_no, materials, gate_in, collected_at, sent_to_lab_at,
//      collected_by, moisture, broken, fm, color, smell, variety, grain_size,
//      verdict, comment, tested_by, tested_at, negotiation }
const drawLabTestReport = (doc, d) => {
  // Start a new page when the next block would run into the signature line
  // (only happens when a lot of extra / custom parameters were entered).
  const ensure = (y, h) => {
    if (y + h <= SIG_Y - 8) return y;
    doc.addPage();
    return M + 4;
  };
  const v = VERDICT[d.verdict] || { label: String(d.verdict || "—").toUpperCase(), color: C.navy, tint: C.panel, note: "" };
  let y = drawHeader(doc, d.plant, "LAB TEST REPORT", v.color);

  y = drawMeta(doc, y, [
    { label: "Report No.", value: d.test_no },
    { label: "Sample Code", value: d.sample_code },
    { label: "Token No.", value: d.token_no },
    { label: "Vehicle No.", value: d.vehicle_no },
  ]);

  // ---- sample & consignment
  y = drawSection(doc, y, "Sample & Consignment Details", v.color);
  y = drawKv(doc, y, [
    [{ l: d.party_label || "Party", v: d.party, bold: true }],
    [{ l: "PO No.", v: d.po_nos }, { l: "Challan No.", v: d.challan_no }],
    [{ l: "Material Tested", v: d.materials, bold: true }, { l: "Vehicle In", v: d.gate_in }],
    [{ l: "Sample Collected", v: d.collected_at }, { l: "Sent to Lab", v: d.sent_to_lab_at }],
    [{ l: "Collected By", v: d.collected_by }],
  ]);
  y += 4;

  // ---- results
  y = drawSection(doc, y, "Test Results", v.color);
  y = drawStats(
    doc,
    y,
    [
      { label: "Moisture", value: pct(d.moisture), unit: "%" },
      { label: "Broken", value: pct(d.broken), unit: "%" },
      { label: "Foreign Matter (FM)", value: pct(d.fm), unit: "%" },
    ],
    50
  );
  // Optional extra parameters — only the ones that were actually entered, four to a row.
  const extra = (d.extra_params || []).filter((p) => pct(p.value) !== null);
  for (let i = 0; i < extra.length; i += 4) {
    y = drawStats(
      doc,
      y,
      extra.slice(i, i + 4).map((p) => ({ label: p.label, value: pct(p.value), unit: p.unit })),
      42
    );
  }
  y = drawKv(doc, y, [
    [{ l: "Colour", v: d.color }, { l: "Smell", v: d.smell }],
    [{ l: "Variety Detected", v: d.variety }, { l: "Grain Size", v: d.grain_size }],
  ]);
  // Parameters added inline for this material, two to a row.
  const custom = d.custom_params || [];
  if (custom.length) {
    const rows = [];
    for (let i = 0; i < custom.length; i += 2) {
      rows.push(custom.slice(i, i + 2).map((c) => ({ l: c.name, v: c.value, bold: true })));
    }
    for (let i = 0; i < rows.length; i += 8) {
      const chunk = rows.slice(i, i + 8);
      y = ensure(y, chunk.length * 18 + 6);
      y = drawKv(doc, y, chunk);
    }
  }
  y += 4;

  // ---- verdict
  y = drawSection(doc, y, "Verdict", v.color);
  const vh = d.negotiation ? 66 : 52;
  doc.save().roundedRect(L, y, W, vh, 4).fill(v.tint).restore();
  doc.save().rect(L, y, 6, vh).fill(v.color).restore();
  text(doc, v.label, L + 20, y + 10, { size: 19, bold: true, color: v.color });
  text(doc, v.note, L + 20, y + 35, { size: 8.2, color: C.ink, width: W - 36 });
  if (d.negotiation) {
    const n = d.negotiation;
    const resp = n.response ? ` | Vendor: ${n.response}` : " | Vendor response pending";
    text(doc, `Rate: ${money(n.old_rate)}  ->  proposed ${money(n.proposed_rate)}${resp}`, L + 20, y + 49, { size: 8.2, bold: true, color: v.color, width: W - 36 });
  }
  y += vh + 12;

  // ---- analyst remarks (remarks + test record kept together)
  y = ensure(y, 20 + 56 + 12 + 20 + 24 + 6);
  y = drawSection(doc, y, "Analyst Remarks", v.color);
  const rh = 56;
  doc.save().lineWidth(0.6).strokeColor(C.line).rect(L, y, W, rh).stroke().restore();
  if (isBlank(d.comment)) {
    text(doc, "No remarks recorded.", L + 10, y + 10, { size: 8.6, italic: true, color: C.muted });
  } else {
    doc.font("Helvetica").fontSize(8.8).fillColor(C.ink).text(safe(d.comment), L + 10, y + 9, { width: W - 20, height: rh - 16, ellipsis: true });
  }
  y += rh + 12;

  // ---- test record
  y = drawSection(doc, y, "Test Record", v.color);
  y = drawKv(doc, y, [[{ l: "Tested By", v: d.tested_by, bold: true }, { l: "Tested At", v: d.tested_at }]]);

  drawSignatures(doc, ["Lab Analyst", "Quality Incharge", "Purchase / Stores"]);
  drawFooter(doc, `Lab Test Report  |  ${d.test_no || ""}  |  ${d.sample_code || ""}`, "report");
};

module.exports = { drawLabTestReport, fmtDT };
