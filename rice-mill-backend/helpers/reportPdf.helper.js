const PDFDocument = require("pdfkit");

// Shared PDF engine for the table-style reports (Inventory Stock Movement,
// Inventory Stock, the Warehouse "Stock Report", Production Summary). One look
// for all of them: plant letterhead, underlined title, filter lines, an
// optional KPI strip, a grouped table with a repeating header, zebra rows,
// sub-totals and a grand total, footnotes, and a "Generated on / Page x of y"
// footer on every page.
//
// Cell values may be plain strings/numbers or { t, bold, color, fill, align }.
// A group is { title, meta?, rows: [{ cells: (n) => [...] }], subtotalCells?,
// note? }; rows may also carry `fill`.

// ---------------------------------------------------------------- formatting
const pad2 = (n) => String(n).padStart(2, "0");
const ymdLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fmtDMY = (d) => `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
const fmtDMYHM = (d) => `${fmtDMY(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const parseYmd = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
};
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const dayEnd = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

// 1234567.891 -> "12,34,567.891" (Indian digit grouping, always 3 decimals)
const fmtQty = (n) => {
  const v = round3(n);
  const [int, frac] = Math.abs(v).toFixed(3).split(".");
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${v < 0 ? "-" : ""}${grouped}.${frac}`;
};
const fmtCount = (n) => {
  const s = String(Math.floor(Number(n) || 0));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
};

// The built-in PDF fonts are Latin-only; swap anything else for "?" rather
// than print garbage, and the rupee sign for "Rs".
const safe = (v) =>
  String(v ?? "")
    .replace(/\u20B9/g, "Rs ")
    .replace(/[^\x20-\x7E\xA0-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u2192]/g, "?");

// ------------------------------------------------------------------- palette
const NAVY = "#1F2A44";
const GRID = "#A9B2C1";
const HEAD_FILL = "#DDE5F0";
const GROUP_FILL = "#E9EFF8";
const ZEBRA = "#F8FAFD";
const SUB_FILL = "#F1F4F9";
const TOTAL_FILL = "#FFF1DC";

const renderTableReport = (res, opts) => {
  const {
    filename, title, subtitleLines = [], plant, columns, groups = [], totalsRow, emptyText = "Nothing to show.",
    footnotes = [], generatedBy, kpis = [], sections = [],
  } = opts;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  const MARGIN = 34;
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: MARGIN, bufferPages: true });
  doc.pipe(res);

  const L = MARGIN;
  const W = doc.page.width - MARGIN * 2;
  const limitY = () => doc.page.height - MARGIN - 18; // room for the footer
  const scaleCols = (list) => {
    const sc = W / list.reduce((s, c) => s + c.w, 0);
    return list.map((c) => ({ ...c, w: c.w * sc }));
  };
  let cols = scaleCols(columns);
  let currentTitle = title;
  const ROW_H = 17;
  const HEAD_H = 28;
  const FS = 8.3;
  let y = MARGIN;

  const fit = (text, width, size, bold) => {
    let t = safe(text);
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
    if (doc.widthOfString(t) <= width) return t;
    while (t.length > 1 && doc.widthOfString(`${t}...`) > width) t = t.slice(0, -1);
    return `${t}...`;
  };

  const drawCells = (values, o = {}) => {
    const h = o.h || ROW_H;
    let x = L;
    cols.forEach((c, i) => {
      const raw = values[i] ?? "";
      const cell = raw !== null && typeof raw === "object" ? raw : { t: raw };
      const fill = cell.fill || o.fill;
      if (fill) doc.save().rect(x, y, c.w, h).fill(fill).restore();
      doc.lineWidth(0.5).strokeColor(GRID).rect(x, y, c.w, h).stroke();
      const text = cell.t === undefined || cell.t === null ? "" : String(cell.t);
      if (text !== "") {
        const size = o.size || FS;
        const bold = cell.bold ?? o.bold;
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(cell.color || o.color || "#111");
        doc.text(fit(text, c.w - 8, size, bold), x + 4, y + (h - size) / 2 + 0.8, { width: c.w - 8, align: cell.align || c.align || "left", lineBreak: false });
      }
      x += c.w;
    });
    y += h;
  };

  const drawSpanRow = (text, o = {}) => {
    const h = o.h || ROW_H;
    doc.save().rect(L, y, W, h).fill(o.fill || GROUP_FILL).restore();
    doc.lineWidth(0.5).strokeColor(GRID).rect(L, y, W, h).stroke();
    if (o.accent) doc.save().rect(L, y, 3.5, h).fill(o.accent).restore();
    const size = o.size || 9;
    const metaW = o.meta ? Math.min(W * 0.55, doc.font("Helvetica").fontSize(size - 0.7).widthOfString(safe(o.meta)) + 4) : 0;
    doc.font(o.italic ? "Helvetica-Oblique" : "Helvetica-Bold").fontSize(size).fillColor(o.color || NAVY);
    doc.text(fit(text, W - 16 - metaW, size, !o.italic), L + 8, y + (h - size) / 2 + 0.8, { width: W - 16 - metaW, align: "left", lineBreak: false });
    if (o.meta) {
      doc.font("Helvetica").fontSize(size - 0.7).fillColor("#444");
      doc.text(safe(o.meta), L + W - 8 - metaW, y + (h - size) / 2 + 1, { width: metaW, align: "right", lineBreak: false });
    }
    y += h;
  };

  const drawTableHeader = () => {
    let x = L;
    cols.forEach((c) => {
      doc.save().rect(x, y, c.w, HEAD_H).fill(HEAD_FILL).restore();
      doc.lineWidth(0.5).strokeColor(GRID).rect(x, y, c.w, HEAD_H).stroke();
      doc.font("Helvetica-Bold").fontSize(8).fillColor(NAVY);
      const label = safe(c.label);
      const hh = doc.heightOfString(label, { width: c.w - 8, align: "center" });
      doc.text(label, x + 4, y + (HEAD_H - hh) / 2 + 0.5, { width: c.w - 8, align: "center" });
      x += c.w;
    });
    y += HEAD_H;
  };

  const drawFirstPageHeader = () => {
    doc.font("Helvetica-Bold").fontSize(16).fillColor(NAVY)
      .text(safe(plant ? String(plant.name).toUpperCase() : "RICE MILL ERP"), L, y, { width: W, align: "center" });
    if (plant && plant.address) {
      doc.font("Helvetica").fontSize(8.5).fillColor("#444").text(safe(plant.address), L, doc.y + 1, { width: W, align: "center" });
    }
    const ruleY = doc.y + 5;
    doc.save().lineWidth(1.4).strokeColor(NAVY).moveTo(L, ruleY).lineTo(L + W, ruleY).stroke().restore();
    doc.font("Helvetica-Bold").fontSize(12.5).fillColor("#111")
      .text(safe(title), L, ruleY + 7, { width: W, align: "center", underline: true });
    doc.moveDown(0.3);
    subtitleLines.forEach((line) => {
      doc.font("Helvetica").fontSize(8.8).fillColor("#333").text(safe(line), L, doc.y + 1, { width: W, align: "center" });
    });
    y = doc.y + 9;

    if (kpis.length) {
      const gap = 8;
      const bw = (W - gap * (kpis.length - 1)) / kpis.length;
      kpis.forEach((k, i) => {
        const bx = L + i * (bw + gap);
        doc.save().roundedRect(bx, y, bw, 34, 3).fill("#F3F6FB").restore();
        doc.save().roundedRect(bx, y, bw, 34, 3).lineWidth(0.6).strokeColor(GRID).stroke().restore();
        doc.save().rect(bx, y + 4, 2.5, 26).fill(k.color || NAVY).restore();
        doc.font("Helvetica").fontSize(7).fillColor("#566").text(safe(String(k.label).toUpperCase()), bx + 9, y + 6, { width: bw - 14, lineBreak: false });
        doc.font("Helvetica-Bold").fontSize(12).fillColor(k.color || NAVY).text(safe(k.value), bx + 9, y + 16, { width: bw - 14, lineBreak: false });
      });
      y += 34 + 9;
    }
  };

  const newPage = () => {
    doc.addPage({ size: "A4", layout: "landscape", margin: MARGIN });
    y = MARGIN;
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(NAVY).text(`${safe(currentTitle)} (continued)`, L, y, { width: W, align: "left" });
    y = doc.y + 6;
    drawTableHeader();
  };
  const ensure = (h) => {
    if (y + h > limitY()) newPage();
  };

  const drawGroups = (list, empty, totals, startSno = 0) => {
    if (!list.length) drawSpanRow(empty, { fill: "#FFFFFF", color: "#666", h: 26, italic: true });
    let sno = startSno;
    list.forEach((g) => {
      ensure(ROW_H * 3);
      drawSpanRow(g.title, { meta: g.meta, accent: g.accent || NAVY });
      if (g.note) {
        ensure(ROW_H);
        drawSpanRow(g.note, { fill: "#FFF8E6", color: "#7A5A00", italic: true, size: 8 });
      }
      g.rows.forEach((r, i) => {
        ensure(ROW_H);
        sno += 1;
        drawCells(r.cells(sno), { fill: r.fill || (i % 2 === 1 ? ZEBRA : undefined) });
      });
      if (g.subtotalCells) {
        ensure(ROW_H);
        drawCells(g.subtotalCells, { bold: true, fill: SUB_FILL });
      }
    });
    if (list.length && totals) {
      ensure(ROW_H + 4);
      drawCells(totals, { bold: true, fill: TOTAL_FILL, size: 8.8 });
    }
  };

  drawFirstPageHeader();
  drawTableHeader();
  drawGroups(groups, emptyText, totalsRow);

  // Optional extra tables (each with its own columns) on fresh pages after the main one.
  // A section is { title, subtitleLines?, columns, groups, totalsRow?, emptyText?, note? }.
  sections.forEach((sec) => {
    doc.addPage({ size: "A4", layout: "landscape", margin: MARGIN });
    y = MARGIN;
    cols = scaleCols(sec.columns);
    currentTitle = sec.title;
    doc.font("Helvetica-Bold").fontSize(12.5).fillColor("#111").text(safe(sec.title), L, y, { width: W, align: "center", underline: true });
    y = doc.y + 3;
    (sec.subtitleLines || []).forEach((line) => {
      doc.font("Helvetica").fontSize(8.8).fillColor("#333").text(safe(line), L, doc.y + 1, { width: W, align: "center" });
    });
    y = doc.y + 8;
    if (sec.note) {
      const h = doc.font("Helvetica-Oblique").fontSize(7.8).heightOfString(safe(sec.note), { width: W });
      doc.font("Helvetica-Oblique").fontSize(7.8).fillColor("#7A5A00").text(safe(sec.note), L, y, { width: W });
      y += h + 6;
    }
    drawTableHeader();
    drawGroups(sec.groups || [], sec.emptyText || "Nothing to show.", sec.totalsRow);
  });

  if (footnotes.length) {
    y += 10;
    footnotes.forEach((n) => {
      const text = safe(n);
      const h = doc.font("Helvetica").fontSize(7.8).heightOfString(text, { width: W });
      if (y + h > limitY()) newPage();
      doc.font("Helvetica").fontSize(7.8).fillColor("#666").text(text, L, y, { width: W });
      y += h + 3;
    });
  }

  // footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // otherwise writing in the bottom margin spawns a blank page
    const fy = doc.page.height - MARGIN + 2;
    doc.save().lineWidth(0.4).strokeColor(GRID).moveTo(L, fy - 4).lineTo(L + W, fy - 4).stroke().restore();
    doc.font("Helvetica").fontSize(7.5).fillColor("#777");
    doc.text(`Generated on ${fmtDMYHM(new Date())}${generatedBy ? ` by ${safe(generatedBy)}` : ""}`, L, fy, { width: W / 2, align: "left", lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, L + W / 2, fy, { width: W / 2, align: "right", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }

  doc.end();
};

module.exports = {
  renderTableReport,
  pad2, ymdLocal, fmtDMY, fmtDMYHM, parseYmd, dayStart, dayEnd, round3, fmtQty, fmtCount, safe,
  COLORS: { NAVY, GRID, HEAD_FILL, GROUP_FILL, ZEBRA, SUB_FILL, TOTAL_FILL },
};