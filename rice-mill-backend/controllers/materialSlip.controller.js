const createError = require("http-errors");
const { KG_PER_QTL } = require("../helpers/units");
const PDFDocument = require("pdfkit");
const {
  Lot, MaterialMaster, VarietyMaster, PlantMaster, WarehouseMaster, BinStackMaster, Stack,
  Purchase, PurchaseOrder, GateEntry, Vendor, Vehicle, Driver, WeightSlip,
  Loading, SalesOrder, Customer,
} = require("../models/index");

// Generates the two paper-form-style PDFs the mill already uses on the
// ground (Material Inward Slip / Material Outward Slip) from live data,
// laid out to match those forms. Both use the same drawing helpers below.

const PAGE = { size: "A4", margin: 36 };

const drawLetterhead = (doc, plant, title) => {
  const { left, right } = doc.page.margins;
  const width = doc.page.width - left - right;
  doc.rect(doc.page.margins.left - 6, doc.page.margins.top - 6, width + 12, doc.page.height - doc.page.margins.top - doc.page.margins.bottom + 12).stroke();
  doc.font("Helvetica-Bold").fontSize(22).text((plant?.name || "RICE MILL").toUpperCase(), { align: "center" });
  if (plant?.address) {
    doc.font("Helvetica-Bold").fontSize(9).text(`Address: ${plant.address}`, { align: "center" });
  }
  doc.moveDown(0.3);
  doc.font("Helvetica-Bold").fontSize(13).text(title, { align: "center", underline: true });
  doc.moveDown(0.8);
};

// One "label: value ___" line, several per row, evenly spaced.
const drawFieldRow = (doc, fields, width) => {
  const startX = doc.page.margins.left;
  const y = doc.y;
  const colWidth = width / fields.length;
  fields.forEach((f, i) => {
    doc.font("Helvetica-Bold").fontSize(9.5).text(f.label, startX + i * colWidth, y, { continued: true });
    doc.font("Helvetica").fontSize(9.5).text(` ${f.value || "—"}`, { width: colWidth - 10 });
  });
  doc.moveDown(0.9);
};

// The numbered "Stack Details" grid both forms have — cols cells wide,
// filled with whatever stack entries are passed (blank boxes otherwise,
// same as the blank paper form).
const drawStackGrid = (doc, count, cols, filled, width) => {
  const startX = doc.page.margins.left;
  const cellW = width / cols;
  const cellH = 26;
  const rows = Math.ceil(count / cols);
  let y = doc.y;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const n = r * cols + c + 1;
      if (n > count) break;
      const x = startX + c * cellW;
      doc.rect(x, y, cellW, cellH).stroke();
      doc.font("Helvetica-Bold").fontSize(8).text(String(n), x + 3, y + 3);
      const label = filled.get(n);
      if (label) doc.font("Helvetica").fontSize(7).text(label, x + 3, y + 14, { width: cellW - 6 });
    }
    y += cellH;
  }
  doc.y = y;
  doc.moveDown(0.8);
};

const drawSignatureFooter = (doc, width) => {
  const startX = doc.page.margins.left;
  const y = doc.page.height - doc.page.margins.bottom - 30;
  const colWidth = width / 3;
  ["Driver Signature", "Security Signature", "Supervisor Signature"].forEach((label, i) => {
    doc.font("Helvetica-Bold").fontSize(9.5).text(label, startX + i * colWidth, y, { width: colWidth, align: i === 1 ? "center" : i === 2 ? "right" : "left" });
  });
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString("en-GB") : "—");

module.exports = {
  // GET /api/material-slips/inward/:lotId
  // Generated once a lot's unloading is complete (Lot.unloading_status ===
  // "completed" — see lot.controller.js's bag-count/unloading endpoint,
  // where Stack rows are also created). One slip per Lot (one material/
  // variety line per unloading, matching the paper form).
  inwardSlipPdf: async (req, res, next) => {
    try {
      const lot = await Lot.findOne({
        where: { id: req.params.lotId, is_deleted: false },
        include: [
          { model: MaterialMaster, as: "material", attributes: ["id", "name"] },
          { model: VarietyMaster, as: "variety", attributes: ["id", "variety_name"] },
          { model: PlantMaster, as: "plant", attributes: ["id", "name", "address"] },
          { model: WarehouseMaster, as: "targetWarehouse", attributes: ["id", "name"] },
          {
            model: Stack, as: "stacks", attributes: ["id", "stack_code", "qty"],
            include: [{ model: BinStackMaster, as: "bin", attributes: ["id", "bin_code"] }],
          },
          {
            model: Purchase, as: "purchase", attributes: ["id", "gate_entry_id", "final_qty", "po_id"],
            include: [
              { model: PurchaseOrder, as: "purchaseOrder", attributes: ["id", "po_no"] },
              { model: WeightSlip, as: "weightSlip", attributes: ["id", "gross_weight", "tare_weight"] },
              {
                model: GateEntry, as: "gateEntry",
                attributes: ["id", "token_no", "challan_no", "entry_time", "exit_time"],
                include: [
                  { model: Vendor, as: "vendor", attributes: ["id", "name"] },
                  { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
                ],
              },
            ],
          },
        ],
      });
      if (!lot) throw createError(404, "Lot not found");
      if (lot.unloading_status !== "completed") {
        throw createError(400, "This lot's unloading isn't complete yet — the Inward Slip is generated once bags have been counted and accepted.");
      }

      const purchase = lot.purchase;
      const ge = purchase?.gateEntry;
      const ws = purchase?.weightSlip;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="inward-slip-${lot.lot_no}.pdf"`);

      const doc = new PDFDocument(PAGE);
      doc.pipe(res);

      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      drawLetterhead(doc, lot.plant, "MATERIAL INWARD SLIP");

      drawFieldRow(doc, [
        { label: "Sr. No. :", value: ge?.token_no || lot.lot_no },
        { label: "Date :", value: fmtDate(ge?.entry_time || lot.created_at) },
      ], width);
      drawFieldRow(doc, [{ label: "Supplier Name M/s :", value: ge?.vendor?.name }], width);
      drawFieldRow(doc, [{ label: "Commodity :", value: lot.material?.name }], width);
      drawFieldRow(doc, [{ label: "Variety :", value: lot.variety?.variety_name }], width);
      drawFieldRow(doc, [
        { label: "Supplier Bill No. :", value: purchase?.purchaseOrder?.po_no || ge?.challan_no },
        { label: "Supplier Bill Date :", value: fmtDate(ge?.entry_time) },
      ], width);
      drawFieldRow(doc, [{ label: "Vehicle No. :", value: ge?.vehicle?.vehicle_no }], width);

      // "Total Quantity" (Bill) has no distinct declared-by-supplier figure
      // in this system separate from what was physically counted, so it's
      // shown as bags presented (accepted + rejected) / the weighbridge
      // gross weight — the closest equivalents this system actually tracks.
      const billBags = (lot.accepted_bags || 0) + (lot.rejected_bags || 0);
      drawFieldRow(doc, [
        { label: "Total Quantity : Bill Bags :", value: billBags || "—" },
        { label: "WT :", value: ws?.gross_weight != null ? `${Number(ws.gross_weight).toFixed(0)} kg` : "—" },
      ], width);

      // Accepted Quantity WT = Lot.qty, which this system already stores in
      // Qtl as accepted_bags x bag_size / KG_PER_QTL (1 Qtl = 100 kg) — shown here in kg to match
      // the paper form's units.
      drawFieldRow(doc, [
        { label: "Accepted Quantity : (Bags)", value: lot.accepted_bags ?? "—" },
        { label: "WT :", value: lot.qty != null ? `${(Number(lot.qty) * KG_PER_QTL).toFixed(0)} kg` : "—" },
      ], width);

      doc.font("Helvetica-Bold").fontSize(10).text("Commodity Stack Details :-");
      doc.moveDown(0.3);
      const stackLabels = new Map();
      (lot.stacks || []).forEach((s, i) => {
        stackLabels.set(i + 1, `${s.bin?.bin_code || s.stack_code} (${s.qty} Qtl)`);
      });
      drawStackGrid(doc, 20, 5, stackLabels, width);

      drawFieldRow(doc, [{ label: "Remarks :", value: null }], width);

      drawFieldRow(doc, [
        { label: "Time in :", value: fmtDateTime(ge?.entry_time) },
        { label: "Time Out :", value: fmtDateTime(ge?.exit_time) },
      ], width);

      drawSignatureFooter(doc, width);

      doc.end();
    } catch (err) {
      next(err);
    }
  },

  // GET /api/material-slips/outward/:loadingId
  // Generated once a truck's loading is recorded (one Loading row per
  // gate_entry_id — see loading.controller.js). Dispatch WT on the paper
  // form is this system's "Net Balance": the weighbridge slip tied to this
  // exact gate entry, first weighment minus second weighment (gross -
  // tare) — never a manually entered figure. "—" if no weighbridge slip
  // has been recorded for this gate entry yet.
  outwardSlipPdf: async (req, res, next) => {
    try {
      const loading = await Loading.findOne({
        where: { id: req.params.loadingId, is_deleted: false },
        include: [
          {
            model: GateEntry, as: "gateEntry",
            attributes: ["id", "token_no", "challan_no", "entry_time", "exit_time", "plant_id"],
            include: [
              { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
              { model: Driver, as: "driver", attributes: ["id", "name", "mobile"] },
            ],
          },
          {
            model: SalesOrder, as: "salesOrder", attributes: ["id", "so_no", "customer_id"],
            include: [{ model: Customer, as: "customer", attributes: ["id", "name"] }],
          },
        ],
      });
      if (!loading) throw createError(404, "Loading record not found");

      const ge = loading.gateEntry;
      const plant = ge?.plant_id
        ? await PlantMaster.findOne({ where: { id: ge.plant_id, is_deleted: false } })
        : await PlantMaster.findOne({ where: { is_deleted: false }, order: [["id", "ASC"]] });

      // Balance Weight: the weighbridge slip tied directly to this gate
      // entry (real FK, not a guess) — same rule as the Daily Outward /
      // Daily Report PDFs.
      const weightSlip = ge
        ? await WeightSlip.findOne({ where: { gate_entry_id: ge.id, is_deleted: false }, order: [["weighed_at", "DESC"]] })
        : null;

      let items = loading.items;
      if (typeof items === "string") {
        try { items = JSON.parse(items); } catch { items = []; }
      }
      if (!Array.isArray(items)) items = [];
      const materialIds = [...new Set(items.map((it) => it.material_id).filter(Boolean))];
      const materials = materialIds.length
        ? await MaterialMaster.findAll({ where: { id: materialIds } })
        : [];
      const materialNameById = new Map(materials.map((m) => [m.id, m.name]));

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="outward-slip-${loading.loading_no}.pdf"`);

      const doc = new PDFDocument(PAGE);
      doc.pipe(res);

      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      drawLetterhead(doc, plant, "MATERIAL OUTWARD SLIP");

      drawFieldRow(doc, [
        { label: "Sr. No. :", value: ge?.token_no || loading.loading_no },
        { label: "Date :", value: fmtDate(loading.loaded_at || ge?.entry_time) },
      ], width);
      drawFieldRow(doc, [{ label: "Party Name M/s :", value: loading.salesOrder?.customer?.name }], width);
      drawFieldRow(doc, [
        { label: "Bill No. :", value: ge?.challan_no },
        { label: "Bill Date :", value: fmtDate(ge?.exit_time || ge?.entry_time) },
      ], width);
      drawFieldRow(doc, [
        { label: "Vehicle No. :", value: ge?.vehicle?.vehicle_no },
        // No transporter (company) field is tracked in this system any
        // more — the driver's name is the closest equivalent it has.
        { label: "Driver Name :", value: ge?.driver?.name },
      ], width);

      const commodityNames = [...new Set(items.map((it) => materialNameById.get(it.material_id)).filter(Boolean))];
      drawFieldRow(doc, [
        { label: "Commodity :", value: commodityNames.join(", ") || "—" },
        {
          label: "Net Balance Wt (Dispatch) :",
          value: weightSlip?.net_weight != null ? `${Number(weightSlip.net_weight).toFixed(0)} kg` : "—",
        },
      ], width);

      // ---- Variety table ----
      doc.moveDown(0.2);
      const headers = ["S.No", "Product/Quality", "Packaging", "Bags", "Remark (if any)"];
      const colWidths = [35, width * 0.4, width * 0.2, width * 0.15, width - 35 - width * 0.4 - width * 0.2 - width * 0.15];
      const startX = doc.page.margins.left;
      let y = doc.y;
      const rowH = 18;
      const drawRow = (cells, bold) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
        let x = startX;
        doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), rowH).stroke();
        cells.forEach((c, i) => {
          doc.text(String(c ?? ""), x + 3, y + 4, { width: colWidths[i] - 6 });
          x += colWidths[i];
          if (i < cells.length - 1) doc.moveTo(x, y).lineTo(x, y + rowH).stroke();
        });
        y += rowH;
      };
      drawRow(headers, true);
      const rowCount = Math.max(7, items.length);
      for (let i = 0; i < rowCount; i++) {
        const it = items[i];
        drawRow([
          i + 1,
          it ? materialNameById.get(it.material_id) || `Material ${it.material_id}` : "",
          "—", // Packaging (pack size) isn't recorded on a Loading line item in this system
          "—", // Bags isn't recorded on a Loading line item — only a total qty in Qtl
          "",
        ]);
      }
      const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
      drawRow(["", "Total →", "", totalQty ? `${totalQty} Qtl` : "", ""], true);
      doc.y = y + 8;

      doc.font("Helvetica-Bold").fontSize(10).text("Stack Details :-");
      doc.moveDown(0.3);
      // Not tracked for outward loading in this system (which source stacks
      // were drawn from) — drawn blank, same as the paper form's unused cells.
      drawStackGrid(doc, 18, 9, new Map(), width);

      drawFieldRow(doc, [
        { label: "Vehicle Time In:-", value: fmtDateTime(ge?.entry_time) },
        { label: "Vehicle time Out:-", value: fmtDateTime(ge?.exit_time) },
      ], width);

      drawSignatureFooter(doc, width);

      doc.end();
    } catch (err) {
      next(err);
    }
  },
};
