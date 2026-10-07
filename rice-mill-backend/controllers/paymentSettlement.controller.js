const createError = require("http-errors");
const PDFDocument = require("pdfkit");
const { PaymentSettlement, PlantMaster } = require("../models/index");
const { searchSources, buildSource } = require("../helpers/settlementSource.helper");

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
//                             - commission/trade discount - cd - balance_freight
//                             - hammali (+/-) every Miscellaneous row (Add / Reduce / N/A)
//                             + rounded_value
//   Brokerage amount (H34)  = commission amount (paid to the broker) — only
//                             when the row is "Commission", not "Trade Discount"
//
// COMMISSION vs TRADE DISCOUNT — the Excel has ONE row with a dropdown
// (Trade Discount / Commission). Its Net Payable formula adds up the
// deductions with SUMIFS(G:G, D:D, "Commission"), i.e. it only deducts a row
// whose label is literally "Commission": pick "Trade Discount" and that
// amount silently drops out of the Net Payable (the sheet's own cached value
// proves it: 745,076.51 = 767,249 - 7,672.49 dana - 14,500 freight, with the
// 7,672.49 discount ignored). Here the selected row is ALWAYS deducted, so the
// two choices only differ in whether the figure also counts as brokerage.
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

const COMMISSION_TYPES = { commission: "Commission", trade_discount: "Trade Discount" };
const normaliseCommissionType = (t) => (t === "trade_discount" ? "trade_discount" : "commission");

// Miscellaneous Amount and Receiving Pending: optional figures the user types,
// each either taken off ("reduce", the default) or put on ("add") the Net Payable.
const AMOUNT_MODES = ["reduce", "add"];
const normaliseAmountMode = (m) => (m === "add" ? "add" : "reduce");

// Miscellaneous Amounts: any number of named rows, e.g. "LOADING CHARGE - 500 - Reduce".
// Each row is { name, amount, mode } with amount typed as a positive figure and mode
//   "add"    -> put on the Net Payable (+)
//   "reduce" -> taken off the Net Payable (-)
//   "na"     -> not applicable: kept on the form but no effect on the Net Payable and not printed
// (Receiving Pending was removed from the form; a value saved on an older settlement is
// still honoured below so that settlement's printed Net Payable never changes.)
const MISC_MODES = ["add", "reduce", "na"];
const cleanMiscItems = (rows) =>
  (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      name: r && r.name ? String(r.name).trim().slice(0, 100) : "",
      amount: round2(r && r.amount),
      mode: r && MISC_MODES.includes(r.mode) ? r.mode : "reduce",
    }))
    .filter((r) => r.name || r.amount);
const miscEffectOf = (r) => (r.mode === "add" ? r.amount : r.mode === "reduce" ? -r.amount : 0);

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
  const balanceFreight = round2(data.balance_freight);
  const roundedValue = round2(data.rounded_value);
  const commissionType = normaliseCommissionType(data.commission_type);
  // The new rows; a settlement saved before they existed carries one legacy misc_amount instead.
  let miscItems = cleanMiscItems(data.misc_items);
  if (!miscItems.length && round2(data.misc_amount)) {
    miscItems = [{ name: "Miscellaneous Amount", amount: round2(data.misc_amount), mode: normaliseAmountMode(data.misc_mode) }];
  }
  const miscAmount = round2(miscItems.reduce((sum, r) => sum + (r.mode === "na" ? 0 : r.amount), 0));
  const miscMode = normaliseAmountMode(data.misc_mode);
  const miscEffect = round2(miscItems.reduce((sum, r) => sum + miscEffectOf(r), 0));
  const receivingPending = round2(data.receiving_pending);
  const receivingPendingMode = normaliseAmountMode(data.receiving_pending_mode);
  const receivingPendingEffect = receivingPendingMode === "add" ? receivingPending : -receivingPending;

  // Whichever of Commission / Trade Discount is selected is deducted (see the
  // header comment for why this differs from the Excel's SUMIFS-by-label).
  const netPayableAmount = round2(
    totalAmount - tds - danaAmount - qualityDifference - commissionAmount - cdAmount - balanceFreight - hammali
      + miscEffect + receivingPendingEffect + roundedValue
  );

  return {
    netWeight, finalNetWeight, items,
    totalBags, totalWeight, rate, totalAmount,
    danaAmount, commissionAmount, cdAmount,
    commissionType, commissionLabel: COMMISSION_TYPES[commissionType],
    tds, qualityDifference, hammali, balanceFreight, roundedValue,
    miscItems, miscAmount, miscMode, miscEffect, receivingPending, receivingPendingMode,
    netPayableAmount,
    // H34 = G27 x 1 — but only a real Commission is brokerage; a Trade
    // Discount is a price reduction, not money owed to the broker.
    brokerageAmount: commissionType === "commission" ? commissionAmount : 0,
  };
};

const validate = (data) => {
  if (!data.party_name || !data.party_name.trim()) throw createError(400, "Party Name is required");
  if (!data.settlement_date) throw createError(400, "Date is required");
  if (data.load_weight == null || data.empty_weight == null) throw createError(400, "Load Weight and Empty Weight are required");
  if (Number(data.load_weight) < Number(data.empty_weight)) throw createError(400, "Load Weight must be more than Empty Weight");
  if (data.commission_type !== undefined && data.commission_type !== null && !COMMISSION_TYPES[data.commission_type]) {
    throw createError(400, 'Commission type must be "commission" or "trade_discount"');
  }
  ["misc_mode", "receiving_pending_mode"].forEach((k) => {
    if (data[k] !== undefined && data[k] !== null && data[k] !== "" && !AMOUNT_MODES.includes(data[k])) {
      throw createError(400, `${k} must be "add" or "reduce"`);
    }
  });
  if (data.misc_items !== undefined && data.misc_items !== null && !Array.isArray(data.misc_items)) {
    throw createError(400, "Miscellaneous amounts must be a list");
  }
  (Array.isArray(data.misc_items) ? data.misc_items : []).forEach((r, i) => {
    const amount = Number(r && r.amount);
    const hasAmount = r && r.amount !== "" && r.amount != null;
    const hasName = !!(r && r.name && String(r.name).trim());
    if (!hasName && !hasAmount) return; // an untouched blank row is simply dropped
    if (!hasName) throw createError(400, `Miscellaneous row ${i + 1}: please enter a name for the amount`);
    if (hasAmount && (Number.isNaN(amount) || amount < 0)) throw createError(400, `Miscellaneous row ${i + 1} ("${String(r.name).trim()}"): the amount must be 0 or more`);
    if (r.mode !== undefined && r.mode !== "" && !MISC_MODES.includes(r.mode)) throw createError(400, `Miscellaneous row ${i + 1}: choose Add, Reduce or N/A`);
  });
};

const ALLOWED_FIELDS = [
  "gp_no", "settlement_date", "party_name", "lorry_no", "invoice_number_dated", "gst_number",
  "party_mobile", "broker_name", "broker_pan", "load_weight", "empty_weight",
  "less_bag_weight", "less_moisture", "less_misc", "items",
  "tds_amount", "less_dana_pct", "quality_difference", "commission_input", "cd_pct",
  "less_hammali", "rounded_value", "sauda_date", "sauda", "inward_date", "inward_weight",
  "pending_sauda", "payment_through", "payment_date", "remarks", "plant_id",
  "gate_entry_id", "commission_type", "balance_freight", "inward_details",
  "misc_items",
];
// Optional DATEONLY columns — the form's <input type="date"> sends "" when
// left blank, and MySQL rejects "" for a date column outright ("Incorrect
// date value: 'Invalid date'"). Only settlement_date is required; these
// three must become null, not "", when empty.
const DATE_FIELDS = ["sauda_date", "inward_date", "payment_date"];
// [{ date, weight, gp_no }] — drop blank rows, keep weight as a number (kg).
// gp_no is the Gate Pass of the vehicle that made the load.
const cleanInwardDetails = (rows) =>
  (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      date: r && r.date ? String(r.date).slice(0, 10) : "",
      weight: r && r.weight !== "" && r.weight != null && !Number.isNaN(Number(r.weight)) ? Number(r.weight) : null,
      gp_no: r && r.gp_no ? String(r.gp_no).trim().slice(0, 30) : "",
    }))
    .filter((r) => r.date || r.weight !== null);

const pickFields = (body) => {
  const out = Object.fromEntries(
    ALLOWED_FIELDS.filter((k) => body[k] !== undefined).map((k) => [
      k,
      DATE_FIELDS.includes(k) && body[k] === "" ? null : body[k],
    ])
  );
  if (out.gate_entry_id === "" || out.gate_entry_id === 0) out.gate_entry_id = null;
  if (out.balance_freight === "" || out.balance_freight === null) out.balance_freight = 0;
  if (out.misc_items !== undefined) {
    out.misc_items = cleanMiscItems(out.misc_items);
    // the new rows replace the old single Miscellaneous figure, so it must not be counted twice
    out.misc_amount = 0;
  }
  if (out.inward_details !== undefined) {
    out.inward_details = cleanInwardDetails(out.inward_details);
    // Keep the older single inward date / weight columns pointing at the
    // latest load, so anything still reading them keeps working.
    const last = out.inward_details[out.inward_details.length - 1];
    if (last) {
      if (out.inward_date === undefined) out.inward_date = last.date || null;
      if (out.inward_weight === undefined) out.inward_weight = last.weight;
    }
  }
  return out;
};

const serialize = (row) => ({ ...row.get({ plain: true }), computed: computeTotals(row) });

module.exports = {
  // GET /api/payment-settlements/sources?q=
  // Trucks that have checked out (so have a Gate Pass), searchable by GP No.,
  // SO No., PO No., vehicle, token or party — what a settlement is made against.
  sources: async (req, res, next) => {
    try {
      const includeSettled = ["1", "true"].includes(String(req.query.include_settled || "").toLowerCase());
      const data = await searchSources(req.query.q, { includeSettled });
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/payment-settlements/source/:gateEntryId
  // Everything the system can pre-fill for that truck's settlement.
  source: async (req, res, next) => {
    try {
      const data = await buildSource(req.params.gateEntryId);
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

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
  // Single-page A4 "Payment Settlement Advice". Same fields, labels and figures
  // as the mill's paper/Excel form — laid out as a letterhead, grouped
  // sections and a highlighted Net Payable band instead of a raw cell grid.
  // Every block is positioned from an explicit top (never from doc.y, which
  // pdfkit moves after each text() call) and row heights shrink if a long
  // item list is added, so the advice always stays on one page.
  generatePdf: async (req, res, next) => {
    try {
      const row = await PaymentSettlement.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: [{ model: PlantMaster, as: "plant", attributes: ["id", "name", "address"] }],
      });
      if (!row) throw createError(404, "Payment settlement not found");
      // First time this advice's PDF is opened / downloaded = it is settled:
      // the truck then drops out of the "find the truck" list. Best effort —
      // a failure here must never stop the PDF from being served.
      if (!row.pdf_generated_at) {
        try {
          await row.update({ pdf_generated_at: new Date() });
        } catch (e) {
          /* ignore */
        }
      }
      const d = row.get({ plain: true });
      const c = computeTotals(d);
      const plant = d.plant || (await PlantMaster.findOne({ where: { is_deleted: false }, order: [["id", "ASC"]] }));

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
      // The built-in PDF fonts are Latin-only: swap the rupee sign and any
      // other unsupported character instead of printing garbage.
      const safe = (v) =>
        String(v ?? "")
          .replace(/\u20B9/g, "Rs ")
          .replace(/[^\x20-\x7E\xA0-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026]/g, "?");

      const commissionTag = (() => {
        const t = String(d.commission_input ?? "").trim();
        if (!t || t === "0") return "";
        const perQtl = t.match(/^([\d.]+)\s*\/\s*qt?l?/i);
        if (perQtl) return `(${perQtl[1]}/QNTS)`;
        return `(${t.toUpperCase()})`;
      })();
      const danaGrams = Number(d.less_dana_pct) ? Number((Number(d.less_dana_pct) * 1000).toFixed(2)) : 0;

      // Every load made against the order (INWARD DETAILS). Older settlements
      // only have the single inward date / weight.
      let inward = Array.isArray(d.inward_details) ? d.inward_details.filter((r) => r && (r.date || r.weight != null)) : [];
      if (!inward.length && (d.inward_date || d.inward_weight)) inward = [{ date: d.inward_date, weight: d.inward_weight }];
      const inwardTotal = inward.reduce((sum, r) => sum + (Number(r.weight) || 0), 0);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="settlement-${d.id}.pdf"`);

      const doc = new PDFDocument({ size: "A4", margin: 0 });
      doc.pipe(res);

      const M = 28;
      const W = doc.page.width - M * 2;
      const NAVY = "#1f2a44", INK = "#1b1f27", MUTED = "#5b6472", LINE = "#c3cad5", SOFT = "#f1f4f8", ACCENT = "#f5a25d";

      // ---- drawing helpers ----
      const fitSize = (t, w, size, bold) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica");
        let sz = size;
        while (sz > 5.5 && doc.fontSize(sz).widthOfString(t) > w) sz -= 0.5;
        return sz;
      };
      // Text inside a box of height h (vertically centred), shrunk to fit width w.
      const put = (text, x, y, w, h, o = {}) => {
        const t = safe(text);
        if (!t) return;
        const size = fitSize(t, w, o.size || 8, o.bold);
        doc.font(o.bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(o.color || INK);
        doc.text(t, x, y + (h - size) / 2 + size * 0.08, { width: w, align: o.align || "left", lineBreak: false });
      };
      const box = (x, y, w, h, o = {}) => {
        if (o.fill) doc.save().rect(x, y, w, h).fill(o.fill).restore();
        if (o.stroke !== false) doc.save().lineWidth(o.lw || 0.6).strokeColor(o.stroke || LINE).rect(x, y, w, h).stroke().restore();
      };
      const hline = (x1, x2, y, color = LINE, lw = 0.5) => doc.save().lineWidth(lw).strokeColor(color).moveTo(x1, y).lineTo(x2, y).stroke().restore();
      const vline = (x, y1, y2, color = LINE, lw = 0.5) => doc.save().lineWidth(lw).strokeColor(color).moveTo(x, y1).lineTo(x, y2).stroke().restore();

      // ---- vertical budget: a long item list / many inward loads / long remarks
      // shrink the row heights (never spill onto a second page) ----
      const itemRowsN = Math.max(3, c.items.length);
      const baseItemRh = itemRowsN > 9 ? 12.5 : itemRowsN > 6 ? 14.5 : 16;
      // TOTAL, TDS, DANA, QD, COMM/TD, CD, BAL. FREIGHT, ROUNDED (+ HAMMALI / MISC / RECEIVING PENDING when entered)
      const miscPrint = c.miscItems.filter((r) => r.mode !== "na" && Number(r.amount)); // N/A rows and zero amounts are not printed
      const dRowsN = 8 + (Number(c.hammali) ? 1 : 0) + miscPrint.length + (Number(c.receivingPending) ? 1 : 0);
      const MAX_INWARD = 4;
      const inwardShown = inward.length > MAX_INWARD ? inward.slice(0, MAX_INWARD - 1) : inward;
      const inwardExtra = inward.length - inwardShown.length;
      // When more than one vehicle (Gate Pass) was used to complete the order,
      // the Pending Sauda column also lists their GP numbers.
      const inwardGps = [...new Set(inward.map((r) => (r && r.gp_no ? String(r.gp_no).trim() : "")).filter(Boolean))];
      const multiVehicle = inwardGps.length > 1;
      const freightRowsN = Math.max(multiVehicle ? 3 : 2, inwardShown.length + (inwardExtra > 0 ? 1 : 0) + (inward.length ? 1 : 0));
      const remarkLines = (d.remarks || "").split("\n").map((t) => t.trim()).filter(Boolean).slice(0, 6);
      const remarkN = Math.max(2, remarkLines.length);
      // letterhead 50 + title 22 + party 44 + info 51 + weights 40 + item header/total/gap 42
      // + net payable band 36 + freight headings/gap 41 + payment 27 + remark padding 10 + signatures 36
      const fixedH = 50 + 22 + 44 + 51 + 40 + 42 + 36 + 41 + 27 + 10 + 36;
      const variableH = itemRowsN * baseItemRh + dRowsN * 15.5 + freightRowsN * 15 + remarkN * 11;
      const k = Math.max(0.55, Math.min(1, (doc.page.height - M * 2 - fixedH - 4) / variableH));
      const rowFont = (rowH) => Math.min(8.5, rowH * 0.68);

      let y = M;

      // 1. Letterhead + G.P. No.
      box(M, y, W, 50, { fill: NAVY, stroke: false });
      put((plant?.name || "Rice Mill").toUpperCase(), M + 14, y + 8, W - 210, 20, { size: 15, bold: true, color: "#fff" });
      put(plant?.address || "", M + 14, y + 29, W - 210, 12, { size: 7.5, color: "#c9d1e0" });
      const gpText = /^GP-/i.test(d.gp_no || "") ? `G.P.NO : ${d.gp_no}` : `G.P.NO-${d.gp_no || d.id}`;
      box(M + W - 14 - 168, y + 14, 168, 22, { fill: ACCENT, stroke: false });
      put(gpText, M + W - 14 - 168, y + 14, 168, 22, { size: 10, bold: true, color: "#1b1f27", align: "center" });
      y += 50;

      // 2. Title
      box(M, y, W, 22, { fill: SOFT });
      put("PAYMENT SETTLEMENT ADVICE", M, y, W, 22, { size: 11.5, bold: true, color: NAVY, align: "center" });
      y += 22;

      // 3. Party / date / lorry
      const partyH = 44;
      const partyW = W * 0.64;
      box(M, y, W, partyH);
      put("PARTY NAME", M + 8, y + 5, partyW - 16, 8, { size: 6.5, bold: true, color: MUTED });
      put(d.party_name, M + 8, y + 15, partyW - 16, 24, { size: 14, bold: true, color: INK });
      vline(M + partyW, y, y + partyH);
      const rx = M + partyW;
      const rw = W - partyW;
      hline(rx, M + W, y + partyH / 2);
      put("DATE", rx + 8, y, 42, partyH / 2, { size: 7, bold: true, color: MUTED });
      put(fmtDate(d.settlement_date), rx + 50, y, rw - 58, partyH / 2, { size: 9, bold: true });
      put("LORRY", rx + 8, y + partyH / 2, 42, partyH / 2, { size: 7, bold: true, color: MUTED });
      put(d.lorry_no || "", rx + 50, y + partyH / 2, rw - 58, partyH / 2, { size: 9, bold: true });
      y += partyH;

      // 4. Invoice / GST / contacts
      const infoH = 17;
      const halfW = W / 2;
      const infoCell = (label, value, cx, cy) => {
        box(cx, cy, halfW, infoH);
        put(label, cx + 8, cy, halfW * 0.44, infoH, { size: 7, bold: true, color: MUTED });
        put(value, cx + 8 + halfW * 0.44, cy, halfW * 0.56 - 14, infoH, { size: 8.5 });
      };
      infoCell("INVOICE NUMBER/DATED", d.invoice_number_dated || "", M, y);
      infoCell("GST NUMBER", d.gst_number || "", M + halfW, y);
      infoCell("PARTY MOBILE NUMBER", d.party_mobile || "", M, y + infoH);
      infoCell("BROKER NAME", d.broker_name || "", M + halfW, y + infoH);
      infoCell("BROKER PAN", d.broker_pan || "", M, y + infoH * 2);
      box(M + halfW, y + infoH * 2, halfW, infoH);
      y += infoH * 3;

      // 5. Weights
      const wH = 32;
      const wCells = [
        ["LOAD WEIGHT", num(d.load_weight, 3)],
        ["EMPTY WEIGHT", num(d.empty_weight, 3)],
        ["NET WEIGHT", num(c.netWeight, 3), true],
        ["LESS- BAG WEIGHT", blankIfZero(d.less_bag_weight)],
        ["LESS-MOISTURE", blankIfZero(d.less_moisture)],
        ["LESS-MISC", blankIfZero(d.less_misc)],
        ["NET WEIGHT", num(c.finalNetWeight, 3), true],
      ];
      const wW = W / wCells.length;
      wCells.forEach(([label, value, strong], i) => {
        const cx = M + i * wW;
        box(cx, y, wW, wH, strong ? { fill: SOFT } : {});
        put(label, cx + 4, y + 4, wW - 8, 8, { size: 6, bold: true, color: MUTED, align: "center" });
        put(value, cx + 4, y + 13, wW - 8, 16, { size: 10.5, bold: true, align: "center" });
      });
      y += wH + 8;

      // 6. Item table
      const items = c.items;
      const itemRows = itemRowsN;
      const rh = baseItemRh * k;
      const colFrac = [0.34, 0.12, 0.18, 0.16, 0.2];
      const colX = [];
      colFrac.reduce((acc, f, i) => ((colX[i] = M + acc * W), acc + f), 0);
      const colW = colFrac.map((f) => f * W);
      const heads = ["ITEM", "BAGS", "WEIGHT", "RATE", "AMOUNT"];
      const aligns = ["left", "center", "right", "right", "right"];
      box(M, y, W, 17, { fill: NAVY, stroke: false });
      heads.forEach((h, i) => put(h, colX[i] + 8, y, colW[i] - 16, 17, { size: 7.5, bold: true, color: "#fff", align: aligns[i] }));
      y += 17;
      const tableTop = y;
      for (let i = 0; i < itemRows; i++) {
        const it = items[i];
        if (i % 2 === 1) box(M, y, W, rh, { fill: "#fafbfc", stroke: false });
        const cells = it
          ? [it.is_return ? "RETURN" : it.item_name || "Item", it.bags ? String(it.bags) : "", it.weight ? num(it.weight, 3) : "", it.rate ? num(it.rate) : "", num(it.amount) || "0"]
          : ["", "", "", "", "0"];
        cells.forEach((v, ci) => put(v, colX[ci] + 8, y, colW[ci] - 16, rh, { size: rowFont(rh), align: aligns[ci] }));
        y += rh;
        hline(M, M + W, y);
      }
      // TOTAL row
      box(M, y, W, 17, { fill: SOFT });
      const totals = ["TOTAL", String(c.totalBags), num(c.totalWeight, 3), c.rate ? Number(c.rate).toFixed(2) : "", num(c.totalAmount) || "0"];
      totals.forEach((v, ci) => put(v, colX[ci] + 8, y, colW[ci] - 16, 17, { size: 9, bold: true, align: aligns[ci] }));
      y += 17;
      colX.slice(1).forEach((x) => vline(x, tableTop, y));
      box(M, tableTop, W, y - tableTop, { fill: null });
      y += 8;

      // 7. Deductions → Net Payable
      const dRowH = 15.5 * k;
      const amtW = W * 0.3;
      const drawDed = (label, value, o = {}) => {
        box(M, y, W, dRowH, o.strong ? { fill: SOFT } : {});
        put(label, M + 10, y, W - amtW - 20, dRowH, { size: rowFont(dRowH), bold: !!o.strong, color: o.strong ? INK : "#2b303a" });
        vline(M + W - amtW, y, y + dRowH);
        put(value, M + W - amtW + 8, y, amtW - 16, dRowH, { size: Math.min(9, dRowH * 0.7), bold: !!o.strong, align: "right" });
        y += dRowH;
      };
      drawDed("TOTAL", num(c.totalAmount) || "0", { strong: true });
      drawDed("TDS 1%", num(c.tds) || "0");
      drawDed(`LESS DANA${danaGrams ? ` (${danaGrams} GRAM)` : ""}`, num(c.danaAmount) || "0");
      drawDed("Quality Difference", num(c.qualityDifference) || "0");
      drawDed(`LESS ${c.commissionLabel.toUpperCase()}${commissionTag}`, blankIfZero(c.commissionAmount));
      drawDed(`CD ${Number(d.cd_pct) ? num(d.cd_pct) : 1}%`, blankIfZero(c.cdAmount));
      drawDed("BALANCE FREIGHT", blankIfZero(c.balanceFreight));
      if (Number(c.hammali)) drawDed("LESS HAMMALI", num(c.hammali));
      miscPrint.forEach((r) => drawDed(`${r.mode === "add" ? "ADD" : "LESS"} ${r.name.toUpperCase()}`, num(r.amount)));
      if (Number(c.receivingPending)) drawDed(`${c.receivingPendingMode === "add" ? "ADD" : "LESS"} RECEIVING PENDING`, num(c.receivingPending));
      drawDed("ROUNDED VALUE", blankIfZero(c.roundedValue));
      box(M, y, W, 26, { fill: NAVY, stroke: false });
      put("NET PAYABLE AMOUNT", M + 10, y, W - amtW - 20, 26, { size: 11, bold: true, color: "#fff" });
      put(num(c.netPayableAmount) || "0", M + W - amtW + 8, y, amtW - 16, 26, { size: 14, bold: true, color: "#fff", align: "right" });
      y += 26 + 10;

      // 8. Lorry freight payment details | Brokerage details
      const fW = W * 0.7;
      const bW = W - fW;
      const fCols = [0.22, 0.14, 0.2, 0.2, 0.24].map((f) => f * fW);
      const fX = [];
      fCols.reduce((acc, w, i) => ((fX[i] = M + acc), acc + w), 0);
      const secH = 16;
      const subH = 15;
      box(M, y, fW, secH, { fill: SOFT });
      put("LORRY FREIGHT PAYMENT DETAILS", M + 8, y, fW - 16, secH, { size: 8, bold: true, color: NAVY });
      box(M + fW, y, bW, secH, { fill: SOFT });
      put("BROKERAGE DETAILS", M + fW + 8, y, bW - 16, secH, { size: 8, bold: true, color: NAVY });
      y += secH;
      // sub-headers
      const subLabels = ["SAUDA DATE", "SAUDA", "INWARD DETAILS", null, "PENDING SAUDA"];
      subLabels.forEach((t, i) => {
        if (t === null) return;
        const w = i === 2 ? fCols[2] + fCols[3] : fCols[i];
        box(fX[i], y, w, subH);
        put(t, fX[i] + 4, y, w - 8, subH, { size: 7, bold: true, color: MUTED, align: "center" });
      });
      box(M + fW, y, bW / 2, subH);
      put("BROKER NAME", M + fW + 4, y, bW / 2 - 8, subH, { size: 7, bold: true, color: MUTED, align: "center" });
      box(M + fW + bW / 2, y, bW / 2, subH);
      put("AMOUNT", M + fW + bW / 2 + 4, y, bW / 2 - 8, subH, { size: 7, bold: true, color: MUTED, align: "center" });
      y += subH;

      const shown = inwardShown;
      const extra = inwardExtra;
      const dataRows = freightRowsN;
      const dH = 15 * k;
      const dataTop = y;
      for (let i = 0; i < dataRows; i++) {
        const ry = dataTop + i * dH;
        fX.forEach((x, k) => {
          if (k !== 4) box(x, ry, fCols[k], dH); // the Pending Sauda column is drawn once, as one tall cell, below
        });
        if (i === 0) {
          put(fmtDate(d.sauda_date), fX[0] + 4, ry, fCols[0] - 8, dH, { size: Math.min(8.5, dH * 0.7), align: "center" });
          put(d.sauda || "", fX[1] + 4, ry, fCols[1] - 8, dH, { size: Math.min(8.5, dH * 0.7), align: "center" });
        }
        const isTotalRow = inward.length && i === shown.length + (extra > 0 ? 1 : 0);
        if (i < shown.length) {
          put(fmtDate(shown[i].date), fX[2] + 4, ry, fCols[2] - 8, dH, { size: Math.min(8.5, dH * 0.7), align: "center" });
          put(num(shown[i].weight, 3), fX[3] + 4, ry, fCols[3] - 8, dH, { size: Math.min(8.5, dH * 0.7), align: "center" });
        } else if (extra > 0 && i === shown.length) {
          put(`+ ${extra} more load(s)`, fX[2] + 4, ry, fCols[2] + fCols[3] - 8, dH, { size: 7.5, color: MUTED, align: "center" });
        } else if (isTotalRow) {
          put("TOTAL", fX[2] + 4, ry, fCols[2] - 8, dH, { size: 8, bold: true, align: "center" });
          put(num(inwardTotal, 3), fX[3] + 4, ry, fCols[3] - 8, dH, { size: Math.min(8.5, dH * 0.7), bold: true, align: "center" });
        }
      }
      // Pending Sauda: one tall cell — the pending quantity on top and, when
      // several vehicles were used to complete the order, their GP numbers.
      box(fX[4], dataTop, fCols[4], dataRows * dH);
      put(d.pending_sauda || "", fX[4] + 4, dataTop, fCols[4] - 8, dH, { size: Math.min(8.5, dH * 0.7), bold: true, align: "center" });
      if (multiVehicle) {
        const maxGp = 5;
        const gpLines = inwardGps.length > maxGp ? [...inwardGps.slice(0, maxGp - 1), `+ ${inwardGps.length - (maxGp - 1)} more`] : inwardGps;
        const lines = ["VEHICLES (GP NO.)", ...gpLines];
        const room = dataRows * dH - dH - 2;
        const lh = Math.min(9, room / lines.length);
        lines.forEach((t, i2) =>
          put(t, fX[4] + 3, dataTop + dH + i2 * lh, fCols[4] - 6, lh, {
            size: Math.min(i2 === 0 ? 5.8 : 7.2, lh * 0.82),
            bold: i2 > 0 && !t.startsWith("+"),
            color: i2 === 0 ? MUTED : INK,
            align: "center",
          })
        );
      }

      // brokerage box
      const bTop = dataTop;
      const bH = dataRows * dH;
      box(M + fW, bTop, bW / 2, bH);
      box(M + fW + bW / 2, bTop, bW / 2, bH);
      put(d.broker_name || "", M + fW + 6, bTop, bW / 2 - 12, dH * 2, { size: 8.5, bold: true, align: "center" });
      put(blankIfZero(c.brokerageAmount), M + fW + bW / 2 + 4, bTop, bW / 2 - 8, dH * 2, { size: 10, bold: true, align: "center" });
      y = dataTop + bH + 10;

      // 9. Payment through / date
      box(M, y, W / 2, 19);
      put("PAYMENT THROUGH :", M + 8, y, 92, 19, { size: 7.5, bold: true, color: MUTED });
      put(d.payment_through || "", M + 102, y, W / 2 - 110, 19, { size: 9 });
      box(M + W / 2, y, W / 2, 19);
      put("PAYMENT DATE :", M + W / 2 + 8, y, 80, 19, { size: 7.5, bold: true, color: MUTED });
      put(fmtDate(d.payment_date), M + W / 2 + 90, y, W / 2 - 98, 19, { size: 9 });
      y += 19 + 8;

      // 10. Remarks
      const remPitch = 11 * k;
      const remH = remarkN * remPitch + 10;
      box(M, y, W, remH);
      put("REMARK:-", M + 8, y + 5, 52, remPitch, { size: 7.5, bold: true, color: MUTED });
      remarkLines.forEach((t, i) => put(t, M + 62, y + 5 + i * remPitch, W - 70, remPitch, { size: Math.min(7.5, remPitch * 0.7), color: "#2b303a" }));
      y += remH;

      // 11. Signatures — sit at the bottom of the page, under the content
      const sigY = Math.min(Math.max(y + 24, doc.page.height - M - 26), doc.page.height - 20);
      const sigW = 150;
      hline(M + 24, M + 24 + sigW, sigY, "#6b7380", 0.8);
      put("CHECKED BY", M + 24, sigY + 3, sigW, 12, { size: 8, bold: true, color: NAVY, align: "center" });
      hline(M + W - 24 - sigW, M + W - 24, sigY, "#6b7380", 0.8);
      put("PASSED BY", M + W - 24 - sigW, sigY + 3, sigW, 12, { size: 8, bold: true, color: NAVY, align: "center" });

      doc.end();
    } catch (err) {
      next(err);
    }
  },
};