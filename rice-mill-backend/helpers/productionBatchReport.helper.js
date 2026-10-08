const createError = require("http-errors");
const { ProductionBatch, PlantMaster, WarehouseMaster } = require("../models/index");
const { buildBatchMovements, STATUS_LABEL } = require("./productionMovement.helper");
const { fmtQty, fmtCount, fmtDMY } = require("./reportPdf.helper");
const { asArray } = require("./stockHistory.helper");

// Production > Batch > "Production Report" PDF (GET /api/reports/production-batch/:id/report).
//
// One landscape page for one packed batch, in the same look as the other ERP reports:
//
//   INPUT   what the batch consumed, FROM WHICH WAREHOUSE — material, lot, pack size x bags,
//           quantity, and that warehouse's stock before the batch, right after it (closing),
//           and now
//   OUTPUT  the accepted packed goods and the warehouse they were PACKED INTO — pack size x
//           bags, quantity, and that warehouse's stock before / closing after / now
//   REJECTED  rejected output, listed so the report shows the full result (never added to stock)
//
// plus KPIs (input used, accepted output, rejected, recovery %). The stock before / after
// figures are rebuilt from the timestamped stock records (helpers/productionMovement.helper.js
// -> stockHistory.helper.js); where those records no longer add up (stock adjusted by hand)
// the cell says n/a rather than an invented number.
//
// Quantities are Qtl, the unit used throughout Inventory.

const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const DASH = "—";
const GREEN = "#166534";
const AMBER = "#9A3412";
const RED = "#B91C1C";
const stockCell = (v) => (v === null || v === undefined ? { t: "n/a", color: "#888" } : fmtQty(v));
const packText = (size, bags) => `${Number(size)} kg x ${fmtCount(bags)} bag${Number(bags) === 1 ? "" : "s"}`;

const buildBatchReportSpec = async (batchId) => {
  const batch = await ProductionBatch.findOne({ where: { id: batchId, is_deleted: false } });
  if (!batch) throw createError(404, "Production batch not found");
  if (batch.batch_status === "pending") {
    throw createError(400, "This batch hasn't been packed yet — finalize packing first to generate its production report");
  }

  const [movement] = await buildBatchMovements([batch]);
  const destination = batch.destination_warehouse_id
    ? await WarehouseMaster.findOne({ where: { id: batch.destination_warehouse_id, is_deleted: false }, attributes: ["id", "name", "plant_id"] })
    : null;
  const sourceWh = batch.warehouse_id
    ? await WarehouseMaster.findOne({ where: { id: batch.warehouse_id, is_deleted: false }, attributes: ["id", "name", "plant_id"] })
    : null;
  const plantId = (sourceWh && sourceWh.plant_id) || batch.plant_id || null;
  const plant = (plantId && (await PlantMaster.findOne({ where: { id: plantId, is_deleted: false } })))
    || (await PlantMaster.findOne({ where: { is_deleted: false }, order: [["id", "ASC"]] }));

  // ---- the batch's own input lines, so each material shows its lots and pack size x bags ----
  const lines = asArray(batch.materials_data);
  const linesOf = (materialId) => lines.filter((l) => Number(l.material_id) === Number(materialId));

  // ---- INPUT ----
  const inputRows = movement.used.map((u) => {
    const mine = linesOf(u.material_id);
    const bags = mine.reduce((s, l) => s + (Number(l.bag_count) || 0), 0);
    const packs = [];
    mine.forEach((l) => {
      if (Number(l.pack_size) > 0 && Number(l.bag_count) > 0) packs.push(packText(l.pack_size, l.bag_count));
    });
    const lotTxt = u.lots.length ? `Lot ${u.lots.join(", ")}` : "";
    return {
      qty: u.qty, bags,
      cells: (n) => [
        n, { t: "INPUT", bold: true, color: AMBER }, u.material_name,
        [lotTxt, ...new Set(packs)].filter(Boolean).join("  |  ") || DASH,
        u.warehouse_name, bags ? fmtCount(bags) : DASH, { t: fmtQty(u.qty), bold: true },
        stockCell(u.before), stockCell(u.after), { t: fmtQty(u.current), bold: true },
      ],
    };
  });

  // ---- OUTPUT (accepted, packed into the destination warehouse) ----
  const outputRows = movement.produced.map((p) => {
    const bags = p.packs.reduce((s, k) => s + k.bags, 0);
    return {
      qty: p.qty, bags,
      cells: (n) => [
        n, { t: "OUTPUT", bold: true, color: GREEN }, p.material_name,
        p.packs.map((k) => packText(k.pack_size, k.bags)).join(",  ") || DASH,
        p.warehouse_name, bags ? fmtCount(bags) : DASH, { t: fmtQty(p.qty), bold: true },
        stockCell(p.before), stockCell(p.after), { t: fmtQty(p.current), bold: true },
      ],
    };
  });

  // ---- REJECTED (recorded at finalize; never added to stock) ----
  const rejected = (Array.isArray(batch.outputs_data && batch.outputs_data.outputs) ? batch.outputs_data.outputs : []).filter((o) => Number(o.rejected_bags) > 0);
  const rejectedRows = rejected.map((o) => ({
    qty: Number(o.rejected_qty) || 0, bags: Number(o.rejected_bags) || 0,
    cells: (n) => [
      n, { t: "REJECTED", bold: true, color: RED }, o.material_name || `Material ${o.material_id}`,
      Number(o.pack_size) > 0 ? packText(o.pack_size, o.rejected_bags) : DASH, { t: "Not added to stock", color: "#888" },
      fmtCount(o.rejected_bags), { t: fmtQty(Number(o.rejected_qty) || 0), bold: true }, DASH, DASH, DASH,
    ],
  }));

  const sum = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const inputQty = r3(movement.input_qty);
  const outputQty = r3(sum(outputRows, "qty"));
  const rejectedQty = r3(sum(rejectedRows, "qty"));
  const recovery = movement.recovery_pct != null ? `${movement.recovery_pct}%` : DASH;

  const subtotal = (label, rows) => ["", "", label, "", "", sum(rows, "bags") > 0 ? fmtCount(sum(rows, "bags")) : DASH, fmtQty(sum(rows, "qty")), "", "", ""];
  const groups = [
    {
      title: `INPUT  -  USED FROM WAREHOUSE: ${String(movement.source_warehouse.name).toUpperCase()}`,
      meta: `${inputRows.length} material(s)  |  ${fmtQty(inputQty)} Qtl`,
      accent: AMBER,
      note: inputRows.length ? undefined : "No input materials were recorded for this batch.",
      rows: inputRows,
      subtotalCells: inputRows.length ? subtotal("Total input", inputRows) : undefined,
    },
    {
      title: `OUTPUT  -  PACKED INTO WAREHOUSE: ${String((movement.destination_warehouses.join(", ") || (destination && destination.name) || "—")).toUpperCase()}`,
      meta: `${outputRows.length} line(s)  |  ${fmtQty(outputQty)} Qtl accepted`,
      accent: GREEN,
      note: outputRows.length ? undefined : "No packed output was recorded for this batch.",
      rows: outputRows,
      subtotalCells: outputRows.length ? subtotal("Total accepted output", outputRows) : undefined,
    },
  ];
  if (rejectedRows.length) {
    groups.push({
      title: "REJECTED OUTPUT  -  NOT ADDED TO STOCK",
      meta: `${fmtQty(rejectedQty)} Qtl`,
      accent: RED,
      rows: rejectedRows,
      subtotalCells: subtotal("Total rejected", rejectedRows),
    });
  }

  const dateText = batch.production_date ? fmtDMY(new Date(`${String(batch.production_date).slice(0, 10)}T00:00:00`)) : DASH;
  const route = `Source warehouse: ${movement.source_warehouse.name}   ->   Destination warehouse: ${movement.destination_warehouses.join(", ") || (destination && destination.name) || DASH}`;
  const footnotes = [
    "INPUT = materials the batch drew from its source warehouse (stock moves when the batch is completed). OUTPUT = accepted packed goods added to the destination warehouse. REJECTED output is listed for completeness and is never added to stock. Quantities are in Qtl; stock is not priced in this system, so values are quantities.",
    "Stock before = the quantity of that material held in that warehouse just before this batch moved stock; Closing after batch = right after it finished; Current stock = the live balance now. These are rebuilt from the stock records (there is no stock ledger) - n/a means the records for that warehouse and material no longer add up because stock was adjusted by hand.",
    ...movement.warnings,
  ];

  return {
    filename: `production-report-${batch.batch_no}.pdf`,
    title: "PRODUCTION BATCH REPORT",
    subtitleLines: [
      `Batch No: ${batch.batch_no}   |   Production date: ${dateText}   |   Status: ${STATUS_LABEL[batch.batch_status] || batch.batch_status || DASH}${batch.process_type ? `   |   Process: ${String(batch.process_type).toUpperCase()}` : ""}`,
      route,
    ],
    plant,
    kpis: [
      { label: "Input used (Qtl)", value: fmtQty(inputQty), color: AMBER },
      { label: "Accepted output (Qtl)", value: fmtQty(outputQty), color: GREEN },
      { label: "Rejected (Qtl)", value: fmtQty(rejectedQty), color: rejectedQty ? RED : undefined },
      { label: "Recovery", value: recovery, color: "#1F2A44" },
      { label: "Packed bags", value: fmtCount(sum(outputRows, "bags")) },
    ],
    columns: [
      { label: "S.No", w: 28, align: "center" },
      { label: "Movement", w: 70, align: "left" },
      { label: "Material", w: 112, align: "left" },
      { label: "Lot / Pack size x bags", w: 150, align: "left" },
      { label: "Warehouse", w: 110, align: "left" },
      { label: "Bags", w: 44, align: "right" },
      { label: "Qty (Qtl)", w: 64, align: "right" },
      { label: "Stock before (Qtl)", w: 70, align: "right" },
      { label: "Closing after batch (Qtl)", w: 76, align: "right" },
      { label: "Current stock (Qtl)", w: 70, align: "right" },
    ],
    groups,
    emptyText: "Nothing recorded for this batch.",
    footnotes,
  };
};

module.exports = { buildBatchReportSpec };
