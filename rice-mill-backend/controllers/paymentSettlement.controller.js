const createError = require("http-errors");
const PDFDocument = require("pdfkit");
const { PaymentSettlement, PlantMaster } = require("../models/index");

// "Payment Settlement Advice" — ported field-for-field from the mill's
// reference spreadsheet (Book2.xlsx) and paper form. Every formula below
// is the spreadsheet's own formula for that cell, just written in JS:
//   NET WEIGHT (F12)        = load_weight - empty_weight
//   final "NET WEIGHT" (A16) = F12 - less_bag_weight - less_moisture - less_misc
//   row amount (G18/G19)    = weight x rate
//   TOTAL bags/weight (C22/D22) = sum(main rows) - sum(return rows)
//   TOTAL amount (G22)      = sum(main row amounts) - sum(return row amounts)
//   LESS DANA (G25)         = total_weight x (dana% / 100) x rate
//   Commission (G27)        = qty x rate-per-qtl, OR total_amount x percent —
//                             see computeCommission() for the exact rule
//   CD                      = total_amount x (cd% / 100)
//   NET PAYABLE (G31)       = total_amount - tds - dana - quality_diff
//                             - commission - cd - hammali + rounded_value
//   Brokerage amount (H34)  = commission amount (paid to the broker)
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

// All weights on this form (Load/Empty/Net Weight, the item table's Weight
// column) are in KG, matching the reference paper form exactly and the
// weighbridge slips the rest of this app already records in kg. A real
// Quintal is 100 kg — used ONLY for the two figures the reference form
// itself prices "per quintal": Commission ("10/qtl") and Less Dana. This is
// the standard Indian quintal, not the 1000 kg some other, older parts of
// this app mistakenly call "Qtl" — verified against the reference image's
// own numbers: 30,670 kg net = 306.7 real quintals x Rs 10/qtl = Rs 3,067,
// exactly its printed Commission figure.
const KG_PER_REAL_QUINTAL = 100;
const toQuintal = (kg) => (Number(kg) || 0) / KG_PER_REAL_QUINTAL;

// commission_input can be "10/qtl" (flat per quintal — the reference
// form's own convention), "1%" (percent of the total amount), or a bare
// fraction like 0.01 (also percent of total) — the three branches the
// reference spreadsheet's formula handles.
const computeCommission = (input, totalWeightKg, totalAmount) => {
  const str = String(input ?? "").trim();
  if (!str) return 0;
  const perQtl = str.match(/^([\d.]+)\s*\/\s*qt?l?/i);
  if (perQtl) return round2(toQuintal(totalWeightKg) * Number(perQtl[1]));
  if (str.endsWith("%")) return round2((totalAmount * Number(str.slice(0, -1))) / 100);
  const num = Number(str);
  if (!Number.isNaN(num)) return round2(totalAmount * num);
  return 0;
};

const computeTotals = (data) => {
  const netWeight = round3(Number(data.load_weight) - Number(data.empty_weight));
  const finalNetWeight = round3(
    netWeight - Number(data.less_bag_weight || 0) - Number(data.less_moisture || 0) - Number(data.less_misc || 0)
  );

  const items = (Array.isArray(data.items) ? data.items : []).map((it) => ({
    item_name: it.item_name || "",
    bags: Number(it.bags) || 0,
    // The main (non-return) row's weight defaults to the final net weight
    // above (same as the spreadsheet's D18 = F12) but can be overridden.
    weight: it.weight != null && it.weight !== "" ? round3(it.weight) : it.is_return ? 0 : finalNetWeight,
    rate: Number(it.rate) || 0,
    is_return: !!it.is_return,
    amount: 0, // filled in below
  })).map((it) => ({ ...it, amount: round2(it.weight * it.rate) }));

  const mainRows = items.filter((i) => !i.is_return);
  const returnRows = items.filter((i) => i.is_return);
  const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0);

  const totalBags = sum(mainRows, "bags") - sum(returnRows, "bags");
  const totalWeight = round3(sum(mainRows, "weight") - sum(returnRows, "weight"));
  const rate = mainRows.find((r) => r.rate)?.rate || 0;
  const totalAmount = round2(sum(mainRows, "amount") - sum(returnRows, "amount"));

  // Less Dana: a shrinkage/moisture allowance — dana% of the traded
  // weight, priced at the same rate as the item itself (same weight/rate
  // units as the Amount row above; unlike Commission, this one is NOT
  // quintal-converted — ported directly from the reference spreadsheet's
  // own formula, which multiplies the very same weight and rate cells it
  // uses for the item's own Amount).
  const danaAmount = round2(totalWeight * ((Number(data.less_dana_pct) || 0) / 100) * rate);
  const commissionAmount = computeCommission(data.commission_input, totalWeight, totalAmount);
  const cdAmount = round2((totalAmount * (Number(data.cd_pct) || 0)) / 100);
  const tds = round2(data.tds_amount);
  const qualityDifference = round2(data.quality_difference);
  const hammali = round2(data.less_hammali);
  const roundedValue = round2(data.rounded_value);

  const netPayableAmount = round2(
    totalAmount - tds - danaAmount - qualityDifference - commissionAmount - cdAmount - hammali + roundedValue
  );

  return {
    netWeight, finalNetWeight, items,
    totalBags, totalWeight, rate, totalAmount,
    danaAmount, commissionAmount, cdAmount,
    tds, qualityDifference, hammali, roundedValue,
    netPayableAmount,
    brokerageAmount: commissionAmount, // H34 = G27 x 1
  };
};

const validate = (data) => {
  if (!data.party_name || !data.party_name.trim()) throw createError(400, "Party Name is required");
  if (!data.settlement_date) throw createError(400, "Date is required");
  if (data.load_weight == null || data.empty_weight == null) throw createError(400, "Load Weight and Empty Weight are required");
  if (Number(data.load_weight) < Number(data.empty_weight)) throw createError(400, "Load Weight must be more than Empty Weight");
};

const ALLOWED_FIELDS = [
  "gp_no", "settlement_date", "party_name", "lorry_no", "invoice_number_dated", "gst_number",
  "party_mobile", "broker_name", "broker_pan", "load_weight", "empty_weight",
  "less_bag_weight", "less_moisture", "less_misc", "items",
  "tds_amount", "less_dana_pct", "quality_difference", "commission_input", "cd_pct",
  "less_hammali", "rounded_value", "sauda_date", "sauda", "inward_date", "inward_weight",
  "pending_sauda", "payment_through", "payment_date", "remarks", "plant_id",
];
// Optional DATEONLY columns — the form's <input type="date"> sends "" when
// left blank, and MySQL rejects "" for a date column outright ("Incorrect
// date value: 'Invalid date'"). Only settlement_date is required; these
// three must become null, not "", when empty.
const DATE_FIELDS = ["sauda_date", "inward_date", "payment_date"];
const pickFields = (body) =>
  Object.fromEntries(
    ALLOWED_FIELDS.filter((k) => body[k] !== undefined).map((k) => [
      k,
      DATE_FIELDS.includes(k) && body[k] === "" ? null : body[k],
    ])
  );

const serialize = (row) => ({ ...row.get({ plain: true }), computed: computeTotals(row) });

module.exports = {
  // GET /api/payment-settlements
  getAll: async (req, res, next) => {
    try {
      const { page = 1, limit = 50 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);
      const { rows, count } = await PaymentSettlement.findAndCountAll({
        where: { is_deleted: false },
        include: [{ model: PlantMaster, as: "plant", attributes: ["id", "name"] }],
        order: [["settlement_date", "DESC"], ["id", "DESC"]],
        limit: Number(limit),
        offset,
      });
      res.status(200).json({
        success: true,
        data: rows.map(serialize),
        pagination: { total: count, page: Number(page), limit: Number(limit), totalPages: Math.ceil(count / limit) },
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/payment-settlements/:id
  getById: async (req, res, next) => {
    try {
      const row = await PaymentSettlement.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: [{ model: PlantMaster, as: "plant", attributes: ["id", "name", "address"] }],
      });
      if (!row) throw createError(404, "Payment settlement not found");
      res.status(200).json({ success: true, data: serialize(row) });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/payment-settlements
  create: async (req, res, next) => {
    try {
      validate(req.body);
      const row = await PaymentSettlement.create({
        ...pickFields(req.body),
        created_by: req.user ? req.user.id : null,
      });
      res.status(201).json({ success: true, msg: "Payment settlement saved", data: serialize(row) });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/payment-settlements/:id
  update: async (req, res, next) => {
    try {
      const row = await PaymentSettlement.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!row) throw createError(404, "Payment settlement not found");
      validate({ ...row.get({ plain: true }), ...req.body });
      await row.update({ ...pickFields(req.body), updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Payment settlement updated", data: serialize(row) });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/payment-settlements/:id
  delete: async (req, res, next) => {
    try {
      const row = await PaymentSettlement.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!row) throw createError(404, "Payment settlement not found");
      await row.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Payment settlement deleted" });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/payment-settlements/:id/pdf
  // Single-page A4 layout that mirrors the mill's paper/Excel "Payment
  // Settlement Advice" form cell-for-cell (column proportions below are the
  // form's own, expressed as fractions of its 658-unit width). Every cell is
  // positioned from an explicit row top (never from doc.y, which pdfkit moves
  // after each text() call and which caused the old misaligned rows / extra
  // pages), and the row height shrinks if a long item list is added so the
  // advice always stays on one page.
  generatePdf: async (req, res, next) => {
    try {
      const row = await PaymentSettlement.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: [{ model: PlantMaster, as: "plant", attributes: ["id", "name", "address"] }],
      });
      if (!row) throw createError(404, "Payment settlement not found");
      const d = row.get({ plain: true });
      const c = computeTotals(d);

      // ---- value formatting: plain numbers, exactly like the paper form (no thousands separators) ----
      const pad2 = (n) => String(n).padStart(2, "0");
      const fmtDate = (v) => {
        if (!v) return "";
        const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[3]}-${m[2]}-${m[1]}`;
        const dt = new Date(v);
        return Number.isNaN(dt.getTime()) ? "" : `${pad2(dt.getDate())}-${pad2(dt.getMonth() + 1)}-${dt.getFullYear()}`;
      };
      const num = (n, dp = 2) => {
        if (n === null || n === undefined || n === "") return "";
        const v = Number(n);
        return Number.isFinite(v) ? String(Number(v.toFixed(dp))) : "";
      };
      const blankIfZero = (n) => (Number(n) ? num(n) : "");

      const commissionTag = (() => {
        const s = String(d.commission_input ?? "").trim();
        if (!s || s === "0") return "";
        const perQtl = s.match(/^([\d.]+)\s*\/\s*qt?l?/i);
        if (perQtl) return `(${perQtl[1]}/QNTS)`;
        return `(${s.toUpperCase()})`;
      })();
      const danaGrams = Number(d.less_dana_pct) ? Number((Number(d.less_dana_pct) * 1000).toFixed(2)) : 0;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="settlement-${d.id}.pdf"`);

      const doc = new PDFDocument({ size: "A4", margin: 24 });
      doc.pipe(res);

      const L = doc.page.margins.left;
      const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const U = 658; // the form's own width in layout units
      const X = (u) => L + (u / U) * W;

      // ---- row-count budget so the whole advice fits one page ----
      const itemRows = Math.max(4, c.items.length);
      const remarkLines = (d.remarks || "").split("\n").map((s) => s.trim()).filter(Boolean);
      const remarkRows = Math.max(2, remarkLines.length);
      const units = 1.2 /*banner*/ + 1.3 /*title*/ + 2 /*party/date/lorry*/ + 12 /*invoice..net weight header*/ +
        1 /*item header*/ + itemRows + 1 /*TOTAL*/ + 9 /*TOTAL amt..net payable (net payable counts 1.2)*/ + 0.2 +
        2 /*freight headers*/ + 5 /*freight rows*/ + 2 /*payment through/date*/ + remarkRows + 3 /*signatures*/;
      const availH = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
      const rh = Math.min(17, availH / units);
      const fs = Math.min(9, rh * 0.55);

      let y = doc.page.margins.top;

      // One cell: border + text, positioned from the row top `ry`.
      const cell = (u0, u1, ry, h, text, o = {}) => {
        const x0 = X(u0), x1 = X(u1), w = x1 - x0;
        if (o.fill) doc.save().rect(x0, ry, w, h).fill(o.fill).restore();
        if (o.border !== false) doc.lineWidth(o.lw || 0.6).strokeColor("#000").rect(x0, ry, w, h).stroke();
        const t = text === null || text === undefined ? "" : String(text);
        if (!t) return;
        let size = o.size || fs;
        doc.font(o.bold ? "Helvetica-Bold" : "Helvetica");
        while (size > 5.5 && doc.fontSize(size).widthOfString(t) > w - 6) size -= 0.5;
        doc.fontSize(size).fillColor("#000");
        const ty = o.top ? ry + 4 : ry + (h - size) / 2 + size * 0.08;
        doc.text(t, x0 + 3, ty, { width: w - 6, align: o.align || "center", lineBreak: false });
      };
      const adv = (h) => { y += h; };

      // 1. Orange G.P. No banner
      cell(0, U, y, rh * 1.2, "", { fill: "#F5A25D", border: false });
      doc.font("Helvetica-Bold").fontSize(fs + 1).fillColor("#000")
        .text(`G.P.NO-${d.gp_no || d.id}`, L, y + (rh * 1.2 - (fs + 1)) / 2 + 0.5, { width: W - 8, align: "right", lineBreak: false });
      adv(rh * 1.2);

      // 2. Title
      cell(0, U, y, rh * 1.3, "PAYMENT SETTLEMENT ADVICE", { bold: true, size: fs + 1.5 });
      adv(rh * 1.3);

      // 3. Party name (spans two rows) + DATE / LORRY
      cell(0, 128, y, rh * 2, "PARTY NAME", { bold: true });
      cell(128, 467, y, rh * 2, d.party_name, { bold: true, size: fs + 5 });
      cell(467, 532, y, rh, "DATE", { bold: true });
      cell(532, 658, y, rh, fmtDate(d.settlement_date));
      cell(467, 532, y + rh, rh, "LORRY", { bold: true });
      cell(532, 658, y + rh, rh, d.lorry_no || "");
      adv(rh * 2);

      // 4. Label (left 55%) / value (right 45%) rows
      const info = (label, value, o = {}) => {
        cell(0, 363, y, rh, label, { bold: true, ...(o.labelOpts || {}) });
        cell(363, 658, y, rh, value, { bold: !!o.boldValue });
        adv(rh);
      };
      info("INVOICE NUMBER/DATED", d.invoice_number_dated || "");
      info("GST NUMBER", d.gst_number || "");
      info("PARTY MOBILE NUMBER", d.party_mobile || "");
      info("BROKER NAME", d.broker_name || "");
      info("BROKER PAN", d.broker_pan || "");
      info("LOAD WEIGHT", num(d.load_weight, 3));
      info("EMPTY WEIGHT", num(d.empty_weight, 3));
      info("NET WEIGHT", num(c.netWeight, 3));
      info("LESS- BAG WEIGHT", blankIfZero(d.less_bag_weight));
      info("LESS-MOISTURE", blankIfZero(d.less_moisture));
      info("LESS-MISC", blankIfZero(d.less_misc));
      // The form prints just the "NET WEIGHT" caption here (the figure itself
      // is the Weight column of the item table right below).
      cell(0, 363, y, rh, "NET WEIGHT", { bold: true });
      cell(363, 658, y, rh, "");
      adv(rh);

      // 5. Item table
      const COL = [0, 128, 202, 364, 467, 658];
      const rowCells = (texts, o = {}) => {
        texts.forEach((t, i) => cell(COL[i], COL[i + 1], y, rh, t, o));
        adv(rh);
      };
      rowCells(["ITEM", "BAGS", "WEIGHT", "RATE", "AMOUNT"], { bold: true });
      for (let i = 0; i < itemRows; i++) {
        const it = c.items[i];
        if (!it) { rowCells(["", "", "", "", "0"]); continue; }
        rowCells([
          it.is_return ? "RETURN" : it.item_name || "Item",
          it.bags ? String(it.bags) : "",
          it.weight ? num(it.weight, 3) : "",
          it.rate ? num(it.rate) : "",
          num(it.amount) || "0",
        ]);
      }
      rowCells([
        "TOTAL",
        String(c.totalBags),
        num(c.totalWeight, 3),
        c.rate ? Number(c.rate).toFixed(2) : "",
        num(c.totalAmount) || "0",
      ], { bold: true });

      // 6. Deductions block (left 0-202 stays empty, as on the form)
      cell(0, 467, y, rh, "TOTAL", { bold: true, border: false, align: "right" });
      cell(467, 658, y, rh, num(c.totalAmount) || "0", { bold: true, lw: 1 });
      adv(rh);
      const dedTop = y;
      const ded = (label, value) => {
        cell(202, 467, y, rh, label);
        cell(467, 658, y, rh, value);
        adv(rh);
      };
      ded("TDS 1%", num(c.tds) || "0");
      ded("LESS DANA", num(c.danaAmount) || "0");
      ded("Quality Difference", num(c.qualityDifference) || "0");
      ded(`LESS COMMISSION${commissionTag}`, blankIfZero(c.commissionAmount));
      ded(`CD ${Number(d.cd_pct) ? num(d.cd_pct) : 1}%`, blankIfZero(c.cdAmount));
      ded("LESS HAMMALI", blankIfZero(c.hammali));
      ded("ROUNDED VALUE", blankIfZero(c.roundedValue));
      cell(202, 467, y, rh * 1.2, "NET PAYABLE AMOUNT", { bold: true, lw: 1 });
      cell(467, 658, y, rh * 1.2, num(c.netPayableAmount) || "0", { bold: true, lw: 1 });
      // empty framed area to the left of the deductions, as on the form
      cell(0, 202, dedTop, y + rh * 1.2 - dedTop, "");
      adv(rh * 1.2 + rh * 0.2);

      // 7. Lorry freight / brokerage details
      cell(0, 363, y, rh, "LORRY FREIGHT PAYMENT DETAILS", { bold: true });
      cell(363, 658, y, rh, "BROKERAGE DETAILS", { bold: true });
      adv(rh);
      const FC = [0, 128, 202, 364, 532, 658];
      ["SAUDA DATE", "SAUDA", "INWARD DETAILS", "PENDING SAUDA", "AMOUNT"].forEach((t, i) => cell(FC[i], FC[i + 1], y, rh, t, { bold: true }));
      adv(rh);
      // data row — inward details is split into date | weight
      cell(0, 128, y, rh, fmtDate(d.sauda_date));
      cell(128, 202, y, rh, d.sauda || "");
      cell(202, 300, y, rh, fmtDate(d.inward_date));
      cell(300, 364, y, rh, num(d.inward_weight, 3));
      cell(364, 532, y, rh, d.pending_sauda || "");
      cell(532, 658, y, rh, blankIfZero(c.brokerageAmount));
      adv(rh);
      const freightRow = (first, weightTxt) => {
        cell(0, 128, y, rh, first);
        cell(128, 202, y, rh, "");
        cell(202, 300, y, rh, "");
        cell(300, 364, y, rh, weightTxt || "");
        cell(364, 532, y, rh, "");
        cell(532, 658, y, rh, "");
        adv(rh);
      };
      freightRow(danaGrams ? `${danaGrams} DANA` : "", "");
      freightRow("", "");
      freightRow(d.broker_name || "", "");
      freightRow("", d.inward_weight ? num(d.inward_weight, 3) : "");

      // 8. Payment through / date / remarks
      cell(0, U, y, rh, "PAYMENT THROUGH :" + (d.payment_through ? `  ${d.payment_through}` : ""), { bold: true, align: "left" });
      adv(rh);
      cell(0, U, y, rh, "PAYMENT DATE :" + (d.payment_date ? `  ${fmtDate(d.payment_date)}` : ""), { bold: true, align: "left" });
      adv(rh);
      for (let i = 0; i < remarkRows; i++) {
        cell(0, 60, y, rh, i === 0 ? "REMARK:-" : "", { bold: true, align: "left" });
        cell(60, U, y, rh, remarkLines[i] || "");
        adv(rh);
      }

      // 9. Signatures
      const sh = rh * 3;
      cell(0, 128, y, sh, "");
      cell(128, 467, y, sh, "CHECKED BY", { bold: true, top: true });
      cell(467, 530, y, sh, "");
      cell(530, 658, y, sh, "PASSED BY", { bold: true, top: true });
      adv(sh);

      doc.end();
    } catch (err) {
      next(err);
    }
  },
};