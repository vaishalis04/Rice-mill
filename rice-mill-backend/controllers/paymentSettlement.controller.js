const createError = require("http-errors");
const PDFDocument = require("pdfkit");
const { PaymentSettlement, PlantMaster } = require("../models/index");

// "Payment Settlement Advice" — ported field-for-field from the mill's
// reference spreadsheet (Book2.xlsx) and paper form. Every formula below
// is the spreadsheet's own formula for that cell, just written in JS:
//   NET WEIGHT (F12)        = load_weight - empty_weight
//   final "NET WEIGHT" (A16) = NET WEIGHT F12 - less_bag_weight - less_moisture - less_misc
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
const pickFields = (body) => Object.fromEntries(ALLOWED_FIELDS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));

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
  generatePdf: async (req, res, next) => {
    try {
      const row = await PaymentSettlement.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: [{ model: PlantMaster, as: "plant", attributes: ["id", "name", "address"] }],
      });
      if (!row) throw createError(404, "Payment settlement not found");
      const d = row.get({ plain: true });
      const c = computeTotals(d);
      const fmtDate = (v) => (v ? new Date(v).toLocaleDateString("en-GB") : "");
      const fmt = (n) => (n === 0 ? "0" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }));

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="settlement-${d.id}.pdf"`);

      const doc = new PDFDocument({ size: "A4", margin: 24 });
      doc.pipe(res);

      const left = doc.page.margins.left;
      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      let y = doc.y;

      // Orange G.P. No. banner, matching the paper form.
      doc.rect(left, y, width, 20).fill("#F5A25D");
      doc.fillColor("#000").font("Helvetica-Bold").fontSize(10).text(`G.P.NO-${d.gp_no || d.id}`, left, y + 5, { width: width - 10, align: "right" });
      y += 24;
      doc.y = y;

      const outerTop = y;
      const rowH = 16;
      const drawRow = (cells, opts = {}) => {
        const h = opts.h || rowH;
        doc.rect(left, doc.y, width, h).stroke();
        let x = left;
        (opts.widths || cells.map(() => width / cells.length)).forEach((w, i) => {
          if (i > 0) doc.moveTo(x, doc.y).lineTo(x, doc.y + h).stroke();
          doc.font(cells[i]?.bold ? "Helvetica-Bold" : "Helvetica").fontSize(cells[i]?.size || 9);
          if (cells[i]?.align === "center") doc.text(cells[i]?.text ?? "", x, doc.y + (h - 10) / 2, { width: w, align: "center" });
          else doc.text(cells[i]?.text ?? "", x + 6, doc.y + (h - 10) / 2, { width: w - 10 });
          x += w;
        });
        doc.y += h;
      };

      drawRow([{ text: "PAYMENT SETTLEMENT ADVICE", bold: true, size: 13, align: "center" }], { h: 20 });
      drawRow(
        [
          { text: "PARTY NAME", bold: true },
          { text: d.party_name, bold: true, size: 12, align: "center" },
          { text: "DATE", bold: true },
          { text: fmtDate(d.settlement_date) },
        ],
        { widths: [width * 0.18, width * 0.42, width * 0.14, width * 0.26], h: 22 }
      );
      drawRow(
        [{ text: "" }, { text: "" }, { text: "LORRY", bold: true }, { text: d.lorry_no || "" }],
        { widths: [width * 0.18, width * 0.42, width * 0.14, width * 0.26] }
      );
      drawRow([{ text: "INVOICE NUMBER/DATED", bold: true }, { text: d.invoice_number_dated || "" }], { widths: [width * 0.4, width * 0.6] });
      drawRow([{ text: "GST NUMBER", bold: true }, { text: d.gst_number || "" }], { widths: [width * 0.4, width * 0.6] });
      drawRow([{ text: "PARTY MOBILE NUMBER", bold: true }, { text: d.party_mobile || "" }], { widths: [width * 0.4, width * 0.6] });
      drawRow([{ text: "BROKER NAME", bold: true }, { text: d.broker_name || "" }], { widths: [width * 0.4, width * 0.6] });
      drawRow([{ text: "BROKER PAN", bold: true }, { text: d.broker_pan || "" }], { widths: [width * 0.4, width * 0.6] });
      drawRow([{ text: "LOAD WEIGHT", bold: true }, { text: fmt(d.load_weight) }], { widths: [width * 0.4, width * 0.6] });
      drawRow([{ text: "EMPTY WEIGHT", bold: true }, { text: fmt(d.empty_weight) }], { widths: [width * 0.4, width * 0.6] });
      drawRow([{ text: "NET WEIGHT", bold: true }, { text: fmt(c.netWeight) }], { widths: [width * 0.4, width * 0.6] });
      drawRow([{ text: "LESS- BAG WEIGHT", bold: true }, { text: fmt(d.less_bag_weight) }], { widths: [width * 0.4, width * 0.6] });
      drawRow([{ text: "LESS-MOISTURE", bold: true }, { text: fmt(d.less_moisture) }], { widths: [width * 0.4, width * 0.6] });
      drawRow([{ text: "LESS-MISC", bold: true }, { text: fmt(d.less_misc) }], { widths: [width * 0.4, width * 0.6] });
      drawRow([{ text: "NET WEIGHT", bold: true }, { text: fmt(c.finalNetWeight), bold: true }], { widths: [width * 0.4, width * 0.6] });

      const itemW = [width * 0.22, width * 0.16, width * 0.2, width * 0.18, width * 0.24];
      drawRow(
        [{ text: "ITEM", bold: true, align: "center" }, { text: "BAGS", bold: true, align: "center" }, { text: "WEIGHT", bold: true, align: "center" }, { text: "RATE", bold: true, align: "center" }, { text: "AMOUNT", bold: true, align: "center" }],
        { widths: itemW }
      );
      c.items.forEach((it) => {
        drawRow(
          [
            { text: it.is_return ? "RETURN" : it.item_name || "Item", align: "center" },
            { text: it.bags ? String(it.bags) : "", align: "center" },
            { text: it.weight ? fmt(it.weight) : "", align: "center" },
            { text: it.rate ? fmt(it.rate) : "", align: "center" },
            { text: it.amount ? fmt(it.amount) : "0", align: "center" },
          ],
          { widths: itemW }
        );
      });
      drawRow(
        [
          { text: "TOTAL", bold: true, align: "center" },
          { text: String(c.totalBags), bold: true, align: "center" },
          { text: fmt(c.totalWeight), bold: true, align: "center" },
          { text: fmt(c.rate), bold: true, align: "center" },
          { text: fmt(c.totalAmount), bold: true, align: "center" },
        ],
        { widths: itemW }
      );

      const deductionW = [width * 0.6, width * 0.4];
      drawRow([{ text: "TOTAL", bold: true, align: "center" }, { text: fmt(c.totalAmount), bold: true, align: "center" }], { widths: deductionW });
      drawRow([{ text: "TDS", align: "center" }, { text: fmt(c.tds), align: "center" }], { widths: deductionW });
      drawRow([{ text: "LESS DANA" + (d.less_dana_pct ? ` (${d.less_dana_pct}%)` : ""), align: "center" }, { text: fmt(c.danaAmount), align: "center" }], { widths: deductionW });
      drawRow([{ text: "Quality Difference", align: "center" }, { text: fmt(c.qualityDifference), align: "center" }], { widths: deductionW });
      drawRow([{ text: `LESS COMMISSION${d.commission_input ? ` (${d.commission_input})` : ""}`, align: "center" }, { text: fmt(c.commissionAmount), align: "center" }], { widths: deductionW });
      drawRow([{ text: "CD" + (d.cd_pct ? ` (${d.cd_pct}%)` : ""), align: "center" }, { text: fmt(c.cdAmount), align: "center" }], { widths: deductionW });
      drawRow([{ text: "LESS HAMMALI", align: "center" }, { text: fmt(c.hammali), align: "center" }], { widths: deductionW });
      drawRow([{ text: "ROUNDED VALUE", align: "center" }, { text: fmt(c.roundedValue), align: "center" }], { widths: deductionW });
      drawRow([{ text: "NET PAYABLE AMOUNT", bold: true, align: "center" }, { text: fmt(c.netPayableAmount), bold: true, align: "center" }], { widths: deductionW, h: 20 });

      drawRow([{ text: "LORRY FREIGHT PAYMENT DETAILS", bold: true, align: "center" }, { text: "BROKERAGE DETAILS", bold: true, align: "center" }], { widths: [width * 0.6, width * 0.4] });
      drawRow(
        [
          { text: "SAUDA DATE", bold: true, align: "center" },
          { text: "SAUDA", bold: true, align: "center" },
          { text: "INWARD DETAILS", bold: true, align: "center" },
          { text: "PENDING SAUDA", bold: true, align: "center" },
          { text: "AMOUNT", bold: true, align: "center" },
        ],
        { widths: [width * 0.15, width * 0.15, width * 0.3, width * 0.2, width * 0.2] }
      );
      drawRow(
        [
          { text: fmtDate(d.sauda_date), align: "center" },
          { text: d.sauda || "", align: "center" },
          { text: [fmtDate(d.inward_date), d.inward_weight ? fmt(d.inward_weight) : ""].filter(Boolean).join(" — "), align: "center" },
          { text: d.pending_sauda || "", align: "center" },
          { text: fmt(c.brokerageAmount), align: "center" },
        ],
        { widths: [width * 0.15, width * 0.15, width * 0.3, width * 0.2, width * 0.2] }
      );

      drawRow([{ text: "PAYMENT THROUGH :", bold: true }, { text: d.payment_through || "" }], { widths: [width * 0.3, width * 0.7] });
      drawRow([{ text: "PAYMENT DATE :", bold: true }, { text: fmtDate(d.payment_date) }], { widths: [width * 0.3, width * 0.7] });

      const remarkLines = (d.remarks || "").split("\n").filter(Boolean);
      drawRow([{ text: "REMARK:-", bold: true }, { text: remarkLines[0] || "" }], { widths: [width * 0.15, width * 0.85] });
      remarkLines.slice(1).forEach((line) => {
        drawRow([{ text: "" }, { text: line }], { widths: [width * 0.15, width * 0.85] });
      });

      drawRow([{ text: "", align: "center" }, { text: "CHECKED BY", bold: true, align: "center" }, { text: "PASSED BY", bold: true, align: "center" }], { widths: [width * 0.34, width * 0.33, width * 0.33], h: 30 });

      doc.rect(left, outerTop, width, doc.y - outerTop).stroke();

      doc.end();
    } catch (err) {
      next(err);
    }
  },
};