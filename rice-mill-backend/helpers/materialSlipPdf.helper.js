// Drawing code for the "MATERIAL INWARD SLIP" and "MATERIAL OUTWARD SLIP".
//
// Pure drawing: it receives already-calculated data (see
// helpers/materialSlipCalc.helper.js and controllers/materialSlip.controller.js)
// and writes onto a pdfkit document created with `margin: 0`. No database
// access and no arithmetic of its own — every figure arrives ready to print.
//
// One look for both slips: navy letterhead, a coloured title ribbon (teal for
// inward, amber for outward), a meta strip, labelled sections, reading boxes
// for the weighbridge, a reconciliation strip, bordered tables with totals,
// three signature lines and a generated-on footer.

const { fmtInt, fmtQtl, fmtKg, fmtSigned } = require("./materialSlipCalc.helper");

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 28;
const L = M;
const W = PAGE_W - M * 2;
const SIG_Y = PAGE_H - M - 50;
const FOOT_Y = PAGE_H - M - 9;

const C = {
  navy: "#1F2A44",
  ink: "#1b1f27",
  muted: "#6b7280",
  line: "#d5dae3",
  headFill: "#e6ebf4",
  zebra: "#f7f9fc",
  totalFill: "#fff3df",
  panel: "#f6f8fb",
  white: "#ffffff",
  ok: "#15803d",
  warn: "#b45309",
  bad: "#b91c1c",
  inward: "#0f766e",
  outward: "#b45309",
};

// Built-in PDF fonts are Latin-only: anything else prints as "?" instead of garbage.
const safe = (v) =>
  String(v ?? "")
    .replace(/\u20B9/g, "Rs ")
    .replace(/[^\x20-\x7E\xA0-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u00B7\u00D7]/g, "?");

const pad2 = (n) => String(n).padStart(2, "0");
const fmtDT = (d) => `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

const fit = (doc, str, maxW, size, bold) => {
  let t = safe(str);
  if (maxW === undefined || maxW <= 0) return maxW <= 0 ? "" : t;
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
  if (doc.widthOfString(t) <= maxW) return t;
  while (t.length > 1 && doc.widthOfString(`${t}...`) > maxW) t = t.slice(0, -1);
  return `${t}...`;
};

const text = (doc, str, x, y, o = {}) => {
  const { size = 9, bold = false, italic = false, color = C.ink, width, align = "left", spacing } = o;
  const font = bold ? "Helvetica-Bold" : italic ? "Helvetica-Oblique" : "Helvetica";
  // Letter-spacing widens the text pdfkit actually draws, so leave room for it
  // or a long label wraps onto the value below it.
  const room = width !== undefined && spacing ? width - spacing * String(str ?? "").length : width;
  const shown = width !== undefined ? fit(doc, str, room, size, bold) : safe(str);
  doc.font(font).fontSize(size).fillColor(color);
  const opts = { lineBreak: false };
  if (width !== undefined) {
    opts.width = width;
    opts.align = align;
  }
  if (spacing) opts.characterSpacing = spacing;
  doc.text(shown, x, y, opts);
};

const isBlank = (v) => v === null || v === undefined || String(v).trim() === "" || v === "—";

// ----------------------------------------------------------------- blocks

const drawHeader = (doc, plant, title, accent) => {
  doc.save().rect(L, M, W, 58).fill(C.navy).restore();
  text(doc, (plant?.name || "RICE MILL").toUpperCase(), L + 16, M + 11, { size: 17, bold: true, color: C.white, width: W - 32, align: "center" });
  if (plant?.address) text(doc, plant.address, L + 16, M + 35, { size: 7.8, color: "#c9d3e8", width: W - 32, align: "center" });
  doc.save().rect(L, M + 58, W, 24).fill(accent).restore();
  text(doc, title, L, M + 58 + 7.3, { size: 11, bold: true, color: C.white, width: W, align: "center", spacing: 1.6 });
  return M + 58 + 24 + 12;
};

const drawMeta = (doc, y, cells) => {
  const h = 36;
  const cw = W / cells.length;
  doc.save().rect(L, y, W, h).fill(C.panel).restore();
  doc.save().lineWidth(0.6).strokeColor(C.line).rect(L, y, W, h).stroke().restore();
  cells.forEach((c, i) => {
    const x = L + i * cw;
    if (i > 0) doc.save().lineWidth(0.5).strokeColor(C.line).moveTo(x, y + 5).lineTo(x, y + h - 5).stroke().restore();
    text(doc, String(c.label).toUpperCase(), x + 10, y + 7, { size: 6.6, bold: true, color: C.muted, spacing: 0.5, width: cw - 16 });
    text(doc, isBlank(c.value) ? "—" : c.value, x + 10, y + 18, { size: 10.5, bold: true, width: cw - 18 });
  });
  return y + h + 12;
};

const drawSection = (doc, y, label, accent) => {
  doc.save().rect(L, y + 1, 3, 11).fill(accent).restore();
  text(doc, String(label).toUpperCase(), L + 9, y + 2.2, { size: 8.2, bold: true, color: C.navy, spacing: 0.7 });
  return y + 19;
};

// rows: [[cellA, cellB], [cellFull], ...]; cell = { l, v, bold?, write? }
// `write` draws a dotted write-in line when the value is empty (paper remarks).
const drawKv = (doc, y, rows, { rowH = 18 } = {}) => {
  const gap = 14;
  const colW = (W - gap) / 2;
  const labelW = 88;
  rows.forEach((row) => {
    const cells = Array.isArray(row) ? row : [row];
    cells.forEach((cell, i) => {
      const full = cells.length === 1;
      const x = L + (i === 0 ? 0 : colW + gap);
      const w = full ? W : colW;
      text(doc, cell.l, x, y + 5, { size: 7.8, bold: true, color: C.navy, width: labelW - 4 });
      const vx = x + labelW;
      if (!isBlank(cell.v)) {
        text(doc, cell.v, vx, y + 4.5, { size: 9, bold: !!cell.bold, width: w - labelW });
      } else if (cell.write) {
        doc.save().lineWidth(0.5).strokeColor("#9aa0a8").dash(1.2, { space: 2 }).moveTo(vx, y + rowH - 5).lineTo(x + w, y + rowH - 5).stroke().undash().restore();
      } else {
        text(doc, "—", vx, y + 4.5, { size: 9, color: C.muted });
      }
      doc.save().lineWidth(0.4).strokeColor(C.line).moveTo(x, y + rowH).lineTo(x + w, y + rowH).stroke().restore();
    });
    y += rowH;
  });
  return y + 6;
};

// cols: [{ label, w, align }]; rows: [{ cells:[str | {t,bold,color}], total?, muted? } | [cells]]
const drawTable = (doc, y, cols, rows, { rowH = 19, headH = 22 } = {}) => {
  const sum = cols.reduce((s, c) => s + c.w, 0);
  const widths = cols.map((c) => (c.w / sum) * W);
  const top = y;

  doc.save().rect(L, y, W, headH).fill(C.headFill).restore();
  let x = L;
  cols.forEach((c, i) => {
    text(doc, c.label, x + 5, y + (headH - 7.6) / 2 + 0.6, { size: 7.6, bold: true, color: C.navy, width: widths[i] - 10, align: c.align || "left" });
    x += widths[i];
  });
  y += headH;

  rows.forEach((raw, ri) => {
    const row = Array.isArray(raw) ? { cells: raw } : raw;
    if (row.total) doc.save().rect(L, y, W, rowH).fill(C.totalFill).restore();
    else if (ri % 2 === 1) doc.save().rect(L, y, W, rowH).fill(C.zebra).restore();
    x = L;
    row.cells.forEach((cell, i) => {
      const c = cell !== null && typeof cell === "object" ? cell : { t: cell };
      const val = isBlank(c.t) ? (c.t === "—" ? "—" : "") : c.t;
      text(doc, val, x + 5, y + (rowH - 8.4) / 2 + 0.6, {
        size: 8.4,
        bold: c.bold ?? !!row.total,
        italic: !!row.muted,
        color: c.color || (row.muted ? C.muted : C.ink),
        width: widths[i] - 10,
        align: cols[i].align || "left",
      });
      x += widths[i];
    });
    y += rowH;
    doc.save().lineWidth(0.4).strokeColor(C.line).moveTo(L, y).lineTo(L + W, y).stroke().restore();
  });

  doc.save().lineWidth(0.7).strokeColor("#8e98ab").rect(L, top, W, y - top).stroke().restore();
  doc.save().lineWidth(0.4).strokeColor(C.line);
  x = L;
  widths.slice(0, -1).forEach((w) => {
    x += w;
    doc.moveTo(x, top).lineTo(x, y).stroke();
  });
  doc.restore();
  return y + 8;
};

// Reading boxes: { label, value, unit, sub, tone: "net" | "ok" | "warn" | "bad", pending }
const drawStats = (doc, y, boxes, h = 50) => {
  const gap = 8;
  const bw = (W - gap * (boxes.length - 1)) / boxes.length;
  boxes.forEach((b, i) => {
    const x = L + i * (bw + gap);
    const dark = b.tone === "net";
    doc.save().roundedRect(x, y, bw, h, 4).fill(dark ? C.navy : C.panel).restore();
    if (!dark) doc.save().roundedRect(x, y, bw, h, 4).lineWidth(0.6).strokeColor(C.line).stroke().restore();
    const labelColor = dark ? "#c9d3e8" : C.muted;
    text(doc, String(b.label).toUpperCase(), x + 10, y + 8, { size: 6.4, bold: true, color: labelColor, spacing: 0.4, width: bw - 16 });

    const valueColor = dark ? C.white : b.tone === "ok" ? C.ok : b.tone === "warn" ? C.warn : b.tone === "bad" ? C.bad : C.ink;
    if (b.pending || isBlank(b.value)) {
      text(doc, b.emptyText || "Pending", x + 10, y + 21, { size: 11, italic: true, color: dark ? "#c9d3e8" : C.muted });
    } else {
      const vs = safe(b.value);
      doc.font("Helvetica-Bold").fontSize(15);
      const vw = doc.widthOfString(vs);
      text(doc, vs, x + 10, y + 19, { size: 15, bold: true, color: valueColor });
      if (b.unit) text(doc, b.unit, x + 10 + vw + 4, y + 25, { size: 8, bold: true, color: labelColor });
    }
    if (b.sub) text(doc, b.sub, x + 10, y + h - 13, { size: 6.8, color: labelColor, width: bw - 16 });
  });
  return y + h + 8;
};

// Hand-fill boxes (paper stack-detail cells the system does not track).
const drawBoxes = (doc, y, count, h = 22) => {
  const gap = 4;
  const bw = (W - gap * (count - 1)) / count;
  for (let i = 0; i < count; i++) {
    const x = L + i * (bw + gap);
    doc.save().lineWidth(0.6).strokeColor("#8e98ab").rect(x, y, bw, h).stroke().restore();
    text(doc, String(i + 1), x + 3, y + 2.5, { size: 6.6, bold: true, color: C.muted });
  }
  return y + h + 8;
};

const drawNote = (doc, y, str) => {
  text(doc, str, L, y, { size: 7, italic: true, color: C.muted, width: W });
  return y + 11;
};

const drawSignatures = (doc, labels) => {
  const gap = 26;
  const w = (W - gap * (labels.length - 1)) / labels.length;
  labels.forEach((lab, i) => {
    const x = L + i * (w + gap);
    doc.save().lineWidth(0.8).strokeColor("#8a909a").moveTo(x, SIG_Y).lineTo(x + w, SIG_Y).stroke().restore();
    text(doc, lab, x, SIG_Y + 5, { size: 8, bold: true, color: C.navy, width: w, align: "center" });
  });
};

const drawFooter = (doc, left, noun = "slip") => {
  doc.save().lineWidth(0.4).strokeColor(C.line).moveTo(L, FOOT_Y - 6).lineTo(L + W, FOOT_Y - 6).stroke().restore();
  text(doc, left, L, FOOT_Y, { size: 6.8, color: C.muted, width: W / 2 });
  text(doc, `Generated ${fmtDT(new Date())}  |  System-generated ${noun}`, L + W / 2, FOOT_Y, { size: 6.8, color: C.muted, width: W / 2, align: "right" });
};

// ------------------------------------------------------- shared readings

const STATUS_TEXT = {
  matched: "Matched",
  excess: "Excess",
  short: "Short",
  pending: "Awaiting 2nd weighment",
};
const STATUS_TONE = { matched: "ok", excess: "warn", short: "bad", pending: undefined };

// Gross / Tare / Net / Net Qty boxes. `inward` decides which reading comes first.
const weighbridgeBoxes = (wb, inward) => {
  const netQtl = wb && wb.net !== null ? wb.net / 100 : null;
  const gross = { label: inward ? "Gross Wt - loaded (in)" : "Gross Wt - loaded (out)", value: wb && wb.gross !== null ? fmtKg(wb.gross) : null, unit: "kg", sub: inward ? "1st weighment" : "2nd weighment" };
  const tare = { label: inward ? "Tare Wt - empty (out)" : "Tare Wt - empty (in)", value: wb && wb.tare !== null ? fmtKg(wb.tare) : null, unit: "kg", sub: inward ? "2nd weighment" : "1st weighment" };
  const net = {
    label: inward ? "Net Weight (gross - tare)" : "Net Balance Wt (dispatch)",
    value: wb && wb.net !== null ? fmtKg(wb.net) : null,
    unit: "kg",
    tone: "net",
    sub: wb?.slip_no ? `Weight slip ${wb.slip_no}` : wb ? "" : "Truck not weighed yet",
  };
  const qty = { label: "Net Quantity", value: netQtl !== null ? fmtQtl(netQtl) : null, unit: "Qtl", sub: "1 Qtl = 100 kg", tone: undefined };
  return inward ? [gross, tare, net, qty] : [tare, gross, net, qty];
};

const reconBoxes = (r, labels) => {
  const diffTone = STATUS_TONE[r.status];
  return [
    { label: labels.assigned, value: r.assigned_qtl !== null ? fmtQtl(r.assigned_qtl) : null, unit: "Qtl", sub: r.assigned_qtl !== null ? `${fmtKg(r.assigned_qtl * 100)} kg` : "", emptyText: "Not set" },
    { label: labels.counted, value: r.counted_qtl !== null ? fmtQtl(r.counted_qtl) : null, unit: "Qtl", sub: r.counted_kg !== null ? `${fmtKg(r.counted_kg)} kg` : "" },
    { label: "Weighbridge Net", value: r.net_qtl !== null ? fmtQtl(r.net_qtl) : null, unit: "Qtl", sub: r.net_kg !== null ? `${fmtKg(r.net_kg)} kg` : "" },
    {
      label: labels.diff || "Scale - Counted",
      value: r.diff_qtl !== null ? fmtSigned(r.diff_qtl, fmtQtl) : null,
      unit: "Qtl",
      tone: diffTone,
      sub: r.diff_kg !== null ? `${fmtSigned(r.diff_kg, fmtKg)} kg  |  ${STATUS_TEXT[r.status]}` : STATUS_TEXT.pending,
    },
  ];
};

// =========================================================== INWARD SLIP
// d: { plant, slip_no, lot_no, date, vehicle_no, supplier, po_no, challan_no,
//      driver_name, warehouse, commodity, variety, time_in, time_out,
//      counts: lotCounts(), weighbridge, recon, truck_lots, stacks:[{code,bin,qty_qtl}] }
const drawInwardSlip = (doc, d) => {
  const A = C.inward;
  let y = drawHeader(doc, d.plant, "MATERIAL INWARD SLIP", A);

  y = drawMeta(doc, y, [
    { label: "Sr. No. (Token)", value: d.slip_no },
    { label: "Lot No.", value: d.lot_no },
    { label: "Date", value: d.date },
    { label: "Vehicle No.", value: d.vehicle_no },
  ]);

  y = drawSection(doc, y, "Consignment Details", A);
  y = drawKv(doc, y, [
    [{ l: "Supplier M/s", v: d.supplier, bold: true }],
    [{ l: "PO No.", v: d.po_no }, { l: "Challan / Bill No.", v: d.challan_no }],
    [{ l: "Driver", v: d.driver_name }, { l: "Warehouse", v: d.warehouse }],
    [{ l: "Commodity", v: d.commodity, bold: true }, { l: "Variety", v: d.variety }],
    [{ l: "Time In", v: d.time_in }, { l: "Time Out", v: d.time_out }],
    [{ l: "Remarks", v: d.remarks, write: true }],
  ]);

  y = drawSection(doc, y, "Bag Count & Quantity - this lot", A);
  const c = d.counts;
  const size = c.bag_size !== null ? fmtKg(c.bag_size) : "—";
  y = drawTable(
    doc,
    y,
    [
      { label: "Particulars", w: 34 },
      { label: "Bags", w: 13, align: "right" },
      { label: "Bag Size (kg)", w: 15, align: "right" },
      { label: "Weight (kg)", w: 19, align: "right" },
      { label: "Quantity (Qtl)", w: 19, align: "right" },
    ],
    [
      ["Accepted (taken into stock)", c.accepted.bags !== null ? fmtInt(c.accepted.bags) : "—", size, fmtKg(c.accepted.kg), fmtQtl(c.accepted.qtl)],
      ["Rejected", c.rejected.bags !== null ? fmtInt(c.rejected.bags) : "0", size, fmtKg(c.rejected.kg), fmtQtl(c.rejected.qtl)],
      { total: true, cells: ["Total Received (accepted + rejected)", c.total.bags !== null ? fmtInt(c.total.bags) : "—", size, fmtKg(c.total.kg), fmtQtl(c.total.qtl)] },
    ]
  );
  if (c.basis === "stored") y = drawNote(doc, y - 4, "No bag size was recorded for this lot - quantities shown are the stored lot quantities.") + 2;

  y = drawSection(doc, y, "Weighbridge Reading - whole truck", A);
  y = drawStats(doc, y, weighbridgeBoxes(d.weighbridge, true), 48);

  y = drawSection(doc, y, `Truck Reconciliation - ${d.truck_lots} lot${d.truck_lots === 1 ? "" : "s"} on this truck`, A);
  y = drawStats(
    doc,
    y,
    reconBoxes(d.recon, { assigned: "Assigned Qty (PO)", counted: "Counted (all lots, bags)", diff: "Scale - Counted" }),
    48
  );

  y = drawSection(doc, y, "Commodity Stack Details", A);
  const stacks = d.stacks || [];
  const MAX_STACK_ROWS = 4;
  const shown = stacks.slice(0, MAX_STACK_ROWS);
  const stackRows = shown.map((s) => [s.code, s.bin || "—", fmtQtl(s.qty_qtl)]);
  if (stacks.length > MAX_STACK_ROWS) stackRows.push({ muted: true, cells: [`+ ${stacks.length - MAX_STACK_ROWS} more stack(s)`, "", ""] });
  if (!stackRows.length) stackRows.push({ muted: true, cells: ["No stack recorded for this lot", "", ""] });
  else if (stacks.length > 1) {
    const qtlTotal = Math.round(stacks.reduce((s, x) => s + (Number(x.qty_qtl) || 0), 0) * 1000) / 1000;
    stackRows.push({ total: true, cells: ["Total stacked", "", fmtQtl(qtlTotal)] });
  }
  y = drawTable(doc, y, [{ label: "Stack", w: 30 }, { label: "Bin / Location", w: 44 }, { label: "Quantity (Qtl)", w: 26, align: "right" }], stackRows, { rowH: 17, headH: 20 });

  drawSignatures(doc, ["Driver Signature", "Security Signature", "Supervisor Signature"]);
  drawFooter(doc, `Material Inward Slip  |  ${d.lot_no || ""}`);
};

// ========================================================== OUTWARD SLIP
// d: { plant, slip_no, loading_no, date, vehicle_no, party, so_nos, challan_no,
//      driver_name, time_in, time_out, lines:[{ name, so_no, bag_size, bags, kg, qtl, adjusted }],
//      totals, weighbridge, recon, passes }
const drawOutwardSlip = (doc, d) => {
  const A = C.outward;
  let y = drawHeader(doc, d.plant, "MATERIAL OUTWARD SLIP", A);

  y = drawMeta(doc, y, [
    { label: "Sr. No. (Token)", value: d.slip_no },
    { label: "Loading No.", value: d.loading_no },
    { label: "Date", value: d.date },
    { label: "Vehicle No.", value: d.vehicle_no },
  ]);

  y = drawSection(doc, y, "Party & Dispatch Details", A);
  y = drawKv(doc, y, [
    [{ l: "Party Name M/s", v: d.party, bold: true }],
    [{ l: "SO No.", v: d.so_nos }, { l: "Bill / Challan No.", v: d.challan_no }],
    [{ l: "Driver Name", v: d.driver_name }, { l: "Loading Passes", v: d.passes_label }],
    [{ l: "Loaded From", v: d.warehouse_names, bold: true }],
    [{ l: "Time In", v: d.time_in }, { l: "Time Out", v: d.time_out }],
    [{ l: "Remarks", v: d.remarks, write: true }],
  ]);

  // How many item rows fit above the fixed blocks that follow the table.
  const BELOW = 8 + 19 + 58 + 19 + 58 + 19 + 30; // weighbridge + recon + stack boxes
  const headerBlock = 19 + 22 + 19; // section title + table head + total row
  const maxRows = Math.max(3, Math.floor((SIG_Y - 10 - BELOW - (y + headerBlock)) / 19));

  y = drawSection(doc, y, "Dispatch Items - this loading", A);
  const lines = d.lines || [];
  const shown = lines.slice(0, lines.length > maxRows ? maxRows - 1 : maxRows);
  const rows = shown.map((l, i) => [
    String(i + 1),
    l.name,
    l.so_no || "—",
    l.warehouse || "—",
    l.bag_size !== null ? fmtKg(l.bag_size) : "—",
    l.bags !== null ? fmtInt(l.bags) : "—",
    fmtKg(l.kg),
    `${fmtQtl(l.qtl)}${l.adjusted ? " *" : ""}`,
  ]);
  if (lines.length > shown.length) rows.push({ muted: true, cells: ["", `+ ${lines.length - shown.length} more line(s) - see Loading record`, "", "", "", "", "", ""] });
  if (!rows.length) rows.push({ muted: true, cells: ["", "No item lines recorded for this loading", "", "", "", "", "", ""] });
  rows.push({
    total: true,
    cells: ["", "Total", "", "", "", d.totals.bags !== null ? fmtInt(d.totals.bags) : "—", fmtKg(d.totals.kg), fmtQtl(d.totals.qtl)],
  });
  y = drawTable(
    doc,
    y,
    [
      { label: "S.No", w: 6, align: "center" },
      { label: "Product / Quality", w: 23 },
      { label: "SO No.", w: 13 },
      { label: "Warehouse", w: 15 },
      { label: "Pack (kg/bag)", w: 12, align: "right" },
      { label: "Bags", w: 9, align: "right" },
      { label: "Qty (kg)", w: 10, align: "right" },
      { label: "Qty (Qtl)", w: 12, align: "right" },
    ],
    rows
  );
  if (lines.some((l) => l.adjusted)) y = drawNote(doc, y - 4, "* Quantity adjusted to the weighbridge reading at the second weighment (bags x bag size differs slightly).") + 2;

  y = drawSection(doc, y, "Weighbridge Reading - whole truck", A);
  y = drawStats(doc, y, weighbridgeBoxes(d.weighbridge, false), 48);

  y = drawSection(doc, y, "Dispatch Reconciliation", A);
  y = drawStats(
    doc,
    y,
    reconBoxes(d.recon, { assigned: "This Loading", counted: "All Passes on Truck", diff: "Scale - Loaded" }).map((b, i) =>
      i === 0 ? { ...b, value: fmtQtl(d.totals.qtl), unit: "Qtl", sub: `${fmtKg(d.totals.kg)} kg` } : b
    ),
    48
  );

  y = drawSection(doc, y, "Stack Details - source stacks (fill by hand)", A);
  drawBoxes(doc, y, 9, 22);

  drawSignatures(doc, ["Driver Signature", "Security Signature", "Supervisor Signature"]);
  drawFooter(doc, `Material Outward Slip  |  ${d.loading_no || ""}`);
};

// The drawing primitives are shared so other PDFs (e.g. the Lab Test report in
// labTestPdf.helper.js) can use exactly the same look.
const ui = {
  C, M, L, W, PAGE_W, PAGE_H, SIG_Y, FOOT_Y,
  safe, text, fmtDT, isBlank,
  drawHeader, drawMeta, drawSection, drawKv, drawTable, drawStats, drawSignatures, drawFooter, drawNote,
};

module.exports = { drawInwardSlip, drawOutwardSlip, ui };
