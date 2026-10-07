const createError = require("http-errors");
const { Op } = require("sequelize");
const PDFDocument = require("pdfkit");
const sequelize = require("../config/db");
const {
  GateEntry, Vehicle, Driver, Vendor, MaterialMaster, PlantMaster,
  ProductionBatch, Lot, LengthGrading, Purchase, Inventory, FinishedGoods, Packing,
  WarehouseMaster, Customer, WeightSlip, GateEntrySalesOrder,
} = require("../models/index");
const { toCsv, sendCsv } = require("../helpers/csv");
const { buildGateSummary } = require("../helpers/gateSummary.helper");
const { renderTableReport, fmtQty, fmtCount, fmtDMY, COLORS } = require("../helpers/reportPdf.helper");
const { buildDailyReportSpec } = require("../helpers/dailyReport.helper");
const { buildBatchReportSpec } = require("../helpers/productionBatchReport.helper");
const { buildWarehouseStockSpec } = require("./inventoryReport.controller");
const { buildBatchMovements } = require("../helpers/productionMovement.helper");

const asArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};
const asObject = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
};

// Shared helper: resolve which PlantMaster row's name/address goes on a
// report's letterhead — the given warehouse's plant if it has one,
// otherwise the first plant on file.
const resolveLetterheadPlant = async (warehouse) => {
  if (warehouse && warehouse.plant_id) {
    const plant = await PlantMaster.findOne({ where: { id: warehouse.plant_id, is_deleted: false } });
    if (plant) return plant;
  }
  return PlantMaster.findOne({ where: { is_deleted: false }, order: [["id", "ASC"]] });
};

// Day-wise, shift-wise, MIS, cycle/process-time reports (Module 23)
// Every endpoint returns plain JSON by default; add ?format=csv to any of them
// to get the same rows as a downloadable CSV file instead (what the FE's
// "Export to CSV" button calls).

// Resolves a date range from either an explicit from/to pair or a named
// rolling period ("today" | "week" | "month"). from/to (if given) always win.
const resolveRange = (query) => {
  const { from, to, period } = query;

  if (from || to) {
    return {
      from: from ? new Date(from) : new Date(0),
      to: to ? new Date(`${to}T23:59:59.999Z`) : new Date(),
      label: `${from || "…"} to ${to || "…"}`,
    };
  }

  const end = new Date();
  const start = new Date();
  if (period === "week") {
    start.setDate(start.getDate() - 6);
  } else if (period === "month") {
    start.setDate(start.getDate() - 29);
  } else {
    // "today" or unspecified
    start.setHours(0, 0, 0, 0);
  }
  if (period !== "week" && period !== "month") end.setHours(23, 59, 59, 999);

  return { from: start, to: end, label: period || "today" };
};

module.exports = {
  // GET /api/reports/gate-summary — live vehicles inside the mill only.
  gateSummary: async (req, res, next) => {
    try {

      const data = await buildGateSummary({ plantId: req.query.plant_id || undefined });
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/reports/production-batch/:id/movement
  productionBatchMovement: async (req, res, next) => {
    try {
      const batch = await ProductionBatch.findOne({
        where: { id: req.params.id, is_deleted: false },
      });
      if (!batch) throw createError(404, "Production batch not found");
      const [movement] = await buildBatchMovements([batch]);
      res.status(200).json({ success: true, data: movement });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/reports/gate-register?from=&to=&page=&limit=&format=json|csv
  gateRegister: async (req, res, next) => {
    try {
      const { from, to, plant_id, page = 1, limit = 50, format } = req.query;

      const where = { is_deleted: false };
      if (plant_id) where.plant_id = plant_id;
      if (from || to) {
        where.entry_time = {};
        if (from) where.entry_time[Op.gte] = new Date(from);
        if (to) where.entry_time[Op.lte] = new Date(`${to}T23:59:59.999Z`);
      }

      const include = [
        { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no", "type"] },
        { model: Driver, as: "driver", attributes: ["id", "name", "mobile"] },
        { model: Vendor, as: "vendor", attributes: ["id", "vendor_code", "name"] },
        { model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name"] },
        { model: PlantMaster, as: "plant", attributes: ["id", "plant_code", "name"] },
      ];

      if (format === "csv") {
        const rows = await GateEntry.findAll({ where, include, order: [["entry_time", "DESC"]] });
        const csvRows = rows.map((r) => ({
          token_no: r.token_no,
          vehicle_no: r.vehicle ? r.vehicle.vehicle_no : "",
          driver_name: r.driver ? r.driver.name : "",
          vendor_name: r.vendor ? r.vendor.name : "",
          material_name: r.material ? r.material.name : "",
          gate_status: r.gate_status,
          expected_qty: r.expected_qty,
          entry_time: r.entry_time,
          exit_time: r.exit_time,
        }));
        const csv = toCsv(csvRows, [
          { key: "token_no", label: "Token No" },
          { key: "vehicle_no", label: "Vehicle No" },
          { key: "driver_name", label: "Driver" },
          { key: "vendor_name", label: "Vendor" },
          { key: "material_name", label: "Material" },
          { key: "gate_status", label: "Status" },
          { key: "expected_qty", label: "Expected Qty (Qtl)" },
          { key: "entry_time", label: "Entry Time" },
          { key: "exit_time", label: "Exit Time" },
        ]);
        return sendCsv(res, "gate-register.csv", csv);
      }

      const offset = (Number(page) - 1) * Number(limit);
      const { rows, count } = await GateEntry.findAndCountAll({
        where, include, order: [["entry_time", "DESC"]], limit: Number(limit), offset, distinct: true,
      });

      res.status(200).json({
        success: true,
        data: rows,
        pagination: { total: count, page: Number(page), limit: Number(limit), totalPages: Math.ceil(count / limit) },
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/reports/production-summary?from=&to=&page=&limit=&format=json|csv
  productionSummary: async (req, res, next) => {
    try {
      const { from, to, plant_id, page = 1, limit = 50, format } = req.query;

      const where = { is_deleted: false };
      if (plant_id) where.plant_id = plant_id;
      if (from || to) {
        where.production_date = {};
        if (from) where.production_date[Op.gte] = from;
        if (to) where.production_date[Op.lte] = to;
      }

      const include = [
        { model: Lot, as: "lot", attributes: ["id", "lot_no", "material_id"], include: [{ model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name"] }] },
        { model: LengthGrading, as: "lengthGrading" },
      ];

      // Output / recovery are worked out exactly as the PDF does: ACCEPTED output = packed
      // finished goods of the batch (Packing -> FinishedGoods, kg -> Qtl); recovery = accepted
      // output / input. (The old figure came from LengthGrading, which the current production
      // flow never fills in — that is why the columns were empty.) Batches that have not packed
      // anything yet show "—".
      const loadOutputs = async (batches) => {
        const ids = batches.map((b) => Number(b.id));
        const packings = ids.length
          ? await Packing.findAll({ where: { batch_id: { [Op.in]: ids }, is_deleted: false }, attributes: ["id", "batch_id"] })
          : [];
        const fgs = packings.length
          ? await FinishedGoods.findAll({ where: { packing_id: { [Op.in]: packings.map((p) => p.id) }, is_deleted: false }, attributes: ["packing_id", "qty"] })
          : [];
        const qtyByPacking = new Map();
        fgs.forEach((f) => qtyByPacking.set(Number(f.packing_id), (qtyByPacking.get(Number(f.packing_id)) || 0) + Number(f.qty || 0) / 1000));
        const out = new Map();
        packings.forEach((p) => {
          const cur = out.get(Number(p.batch_id)) || { qty: 0, packings: 0 };
          cur.qty += qtyByPacking.get(Number(p.id)) || 0;
          cur.packings += 1;
          out.set(Number(p.batch_id), cur);
        });
        return out;
      };

      const buildRow = (batch, outputs = new Map()) => {
        const lines = asArray(batch.materials_data);
        const input_qty = Number((lines.reduce((sum, l) => sum + Number(l.input_qty || 0), 0) || Number(batch.input_qty) || 0).toFixed(3));
        const packed = outputs.get(Number(batch.id));
        const complete = batch.batch_status === "completed" || (packed && packed.packings > 0);
        const output_qty = complete && packed ? Number(packed.qty.toFixed(3)) : null;
        const recovery_pct = output_qty !== null && input_qty > 0 ? Number(((output_qty / input_qty) * 100).toFixed(2)) : null;
        return {
          batch_id: batch.id,
          batch_no: batch.batch_no,
          lot_no: batch.lot ? batch.lot.lot_no : null,
          material: batch.lot && batch.lot.material ? batch.lot.material.name : null,
          process_type: batch.process_type,
          production_date: batch.production_date,
          batch_status: batch.batch_status,
          current_stage: batch.current_stage,
          input_qty,
          output_qty,
          recovery_pct,
        };
      };

      if (format === "pdf") {
        const batches = await ProductionBatch.findAll({ where, order: [["production_date", "DESC"], ["id", "DESC"]] });
        const batchIds = batches.map((batch) => Number(batch.id));
        const [packings, warehouses] = await Promise.all([
          batchIds.length
            ? Packing.findAll({ where: { batch_id: { [Op.in]: batchIds }, is_deleted: false }, attributes: ["id", "batch_id", "material_id", "pack_size", "bag_count", "lot_id"] })
            : [],
          WarehouseMaster.findAll({ where: { is_deleted: false }, attributes: ["id", "name", "plant_id"] }),
        ]);
        const finishedGoods = packings.length
          ? await FinishedGoods.findAll({ where: { packing_id: { [Op.in]: packings.map((packing) => packing.id) }, is_deleted: false }, attributes: ["packing_id", "qty"] })
          : [];
        const materialIds = [...new Set([
          ...batches.flatMap((batch) => asArray(batch.materials_data).map((line) => Number(line.material_id))),
          ...packings.map((packing) => Number(packing.material_id)),
          ...batches.map((batch) => Number(batch.material_id)),
        ].filter(Boolean))];
        const materials = materialIds.length
          ? await MaterialMaster.findAll({ where: { id: { [Op.in]: materialIds } }, attributes: ["id", "name"] })
          : [];
        const materialName = new Map(materials.map((material) => [Number(material.id), material.name]));
        const warehouseName = new Map(warehouses.map((warehouse) => [Number(warehouse.id), warehouse.name]));
        const packingByBatch = new Map();
        packings.forEach((packing) => {
          const list = packingByBatch.get(Number(packing.batch_id)) || [];
          list.push(packing);
          packingByBatch.set(Number(packing.batch_id), list);
        });
        const qtyByPacking = new Map(finishedGoods.map((row) => [Number(row.packing_id), Number(row.qty || 0) / 1000]));

        let totalInput = 0;
        let totalAccepted = 0;
        let totalRejected = 0;
        let completedCount = 0;
        const groups = batches.map((batch) => {
          const inputLines = asArray(batch.materials_data);
          const normalizedInputs = inputLines.length
            ? inputLines
            : batch.material_id
              ? [{ material_id: batch.material_id, input_qty: batch.input_qty, lot_id: batch.lot_id }]
              : [];
          const batchPackings = packingByBatch.get(Number(batch.id)) || [];
          const acceptedTotal = batchPackings.reduce((sum, packing) => sum + (qtyByPacking.get(Number(packing.id)) || 0), 0);
          const rejectedOutputs = asArray(asObject(batch.outputs_data).outputs).filter((output) => Number(output.rejected_qty) > 0);
          const rejectedTotal = rejectedOutputs.reduce((sum, output) => sum + Number(output.rejected_qty || 0), 0);
          const inputTotal = normalizedInputs.reduce((sum, line) => sum + Number(line.input_qty || 0), 0) || Number(batch.input_qty || 0);
          const complete = batch.batch_status === "completed" || batchPackings.length > 0;
          if (complete) {
            completedCount += 1;
            totalInput += inputTotal;
            totalAccepted += acceptedTotal;
            totalRejected += rejectedTotal;
          }

          const rows = normalizedInputs.map((line) => ({
            cells: (n) => [
              n,
              { t: "INPUT", bold: true, color: "#9A3412" },
              materialName.get(Number(line.material_id)) || `Material ${line.material_id}`,
              line.lot_no || (line.lot_id ? `Lot #${line.lot_id}` : "—"),
              warehouseName.get(Number(batch.warehouse_id)) || "—",
              fmtQty(line.input_qty || 0),
              "—",
            ],
          }));
          batchPackings.forEach((packing) => {
            const qty = qtyByPacking.get(Number(packing.id)) || 0;
            rows.push({
              cells: (n) => [
                n,
                { t: "ACCEPTED OUTPUT", bold: true, color: "#166534" },
                materialName.get(Number(packing.material_id)) || `Material ${packing.material_id}`,
                `${fmtCount(packing.bag_count)} bags × ${Number(packing.pack_size)} kg`,
                warehouseName.get(Number(batch.destination_warehouse_id || batch.warehouse_id)) || "—",
                fmtQty(qty),
                "Added to stock",
              ],
            });
          });
          rejectedOutputs.forEach((output) => {
            rows.push({
              cells: (n) => [
                n,
                { t: "REJECTED OUTPUT", bold: true, color: "#B91C1C" },
                output.material_name || materialName.get(Number(output.material_id)) || `Material ${output.material_id}`,
                `${fmtCount(output.rejected_bags)} bags × ${Number(output.pack_size)} kg`,
                "Not added to stock",
                fmtQty(output.rejected_qty),
                "Rejected",
              ],
            });
          });
          if (rows.length === 0) {
            rows.push({ cells: () => ["", "", { t: "No input or output detail recorded.", color: "#888" }, "", "", "", ""] });
          }
          return {
            title: `${batch.batch_no} | ${batch.production_date ? fmtDMY(new Date(`${String(batch.production_date).slice(0, 10)}T00:00:00`)) : "—"} | ${(batch.batch_status || "unknown").toUpperCase()}`,
            meta: `Input ${fmtQty(inputTotal)} Qtl · Accepted ${fmtQty(acceptedTotal)} Qtl · Rejected ${fmtQty(rejectedTotal)} Qtl · Recovery ${inputTotal > 0 ? `${((acceptedTotal / inputTotal) * 100).toFixed(2)}%` : "—"}`,
            accent: complete ? COLORS.NAVY : "#B45309",
            rows,
          };
        });
        const fromLabel = from ? fmtDMY(new Date(`${from}T00:00:00`)) : "All dates";
        const toLabel = to ? fmtDMY(new Date(`${to}T00:00:00`)) : "Today";
        const plant = await PlantMaster.findOne({ where: { is_deleted: false }, order: [["id", "ASC"]] });
        return renderTableReport(res, {
          filename: `production-summary-${from || "all"}${to ? `_to_${to}` : ""}.pdf`,
          title: "PRODUCTION SUMMARY REPORT",
          subtitleLines: [`Production date: ${fromLabel} to ${toLabel}`, "Stock quantities are in Qtl (metric tons)."],
          plant,
          kpis: [
            { label: "Batches", value: String(batches.length) },
            { label: "Completed", value: String(completedCount), color: "#166534" },
            { label: "Input (Qtl)", value: fmtQty(totalInput), color: "#9A3412" },
            { label: "Accepted (Qtl)", value: fmtQty(totalAccepted), color: "#166534" },
            { label: "Rejected (Qtl)", value: fmtQty(totalRejected), color: "#B91C1C" },
          ],
          columns: [
            { label: "No.", w: 35, align: "center" },
            { label: "Type", w: 112 },
            { label: "Material", w: 140 },
            { label: "Lot / Pack", w: 120 },
            { label: "Warehouse / Note", w: 132 },
            { label: "Qty (Qtl)", w: 72, align: "right" },
            { label: "Result", w: 82 },
          ],
          groups,
          emptyText: "No production batches found for the selected date range.",
          footnotes: [
            "Accepted output is based on packed finished-goods records; rejected quantities are shown separately and are not added to stock.",
            "Recovery is accepted output divided by input. Pending batches are listed as reservations and are excluded from completed totals.",
          ],
        });
      }

      if (format === "csv") {
        const rows = await ProductionBatch.findAll({ where, include, order: [["production_date", "DESC"]] });
        const outputs = await loadOutputs(rows);
        const data = rows.map((row) => buildRow(row, outputs));
        const csv = toCsv(data, [
          { key: "batch_no", label: "Batch No" },
          { key: "lot_no", label: "Lot No" },
          { key: "material", label: "Material" },
          { key: "process_type", label: "Process Type" },
          { key: "production_date", label: "Production Date" },
          { key: "batch_status", label: "Status" },
          { key: "current_stage", label: "Current Stage" },
          { key: "input_qty", label: "Input Qty (Qtl)" },
          { key: "output_qty", label: "Output Qty (Qtl)" },
          { key: "recovery_pct", label: "Recovery %" },
        ]);
        return sendCsv(res, "production-summary.csv", csv);
      }

      const offset = (Number(page) - 1) * Number(limit);
      const { rows, count } = await ProductionBatch.findAndCountAll({
        where, include, order: [["production_date", "DESC"]], limit: Number(limit), offset, distinct: true,
      });

      const outputs = await loadOutputs(rows);
      res.status(200).json({
        success: true,
        data: rows.map((row) => buildRow(row, outputs)),
        pagination: { total: count, page: Number(page), limit: Number(limit), totalPages: Math.ceil(count / limit) },
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/reports/material-flow?period=today|week|month&from=&to=&material_id=&format=json|csv
  // Answers "how much came in, how much got processed, how much is in the
  // warehouse right now" for a chosen window. Inward/processed are date-ranged;
  // warehouse stock is always a live snapshot (stock doesn't have a "period").
  materialFlow: async (req, res, next) => {
    try {
      const { material_id, plant_id, format } = req.query;
      const range = resolveRange(req.query);
      const plantWhere = plant_id ? { plant_id } : {};

      // --- Inward: Purchase rows in range, grouped by material via GateEntry ---
      const purchases = await Purchase.findAll({
        where: { ...plantWhere, is_deleted: false, purchase_date: { [Op.between]: [range.from.toISOString().slice(0, 10), range.to.toISOString().slice(0, 10)] } },
        include: [{
          model: GateEntry, as: "gateEntry", attributes: ["material_id"],
          include: [{ model: MaterialMaster, as: "material", attributes: ["id", "name"] }],
        }],
      });
      const inwardByMaterial = {};
      purchases.forEach((p) => {
        const mat = p.gateEntry && p.gateEntry.material;
        if (material_id && (!mat || Number(mat.id) !== Number(material_id))) return;
        const key = mat ? mat.name : "Unknown";
        inwardByMaterial[key] = (inwardByMaterial[key] || 0) + Number(p.final_qty || 0);
      });

      // --- Processed: ProductionBatch rows in range, grouped by material via Lot ---
      const batches = await ProductionBatch.findAll({
        where: { ...plantWhere, is_deleted: false, production_date: { [Op.between]: [range.from.toISOString().slice(0, 10), range.to.toISOString().slice(0, 10)] } },
        include: [
          { model: Lot, as: "lot", attributes: ["material_id"], include: [{ model: MaterialMaster, as: "material", attributes: ["id", "name"] }] },
          { model: LengthGrading, as: "lengthGrading" },
        ],
      });
      const processedByMaterial = {};
      batches.forEach((b) => {
        const mat = b.lot && b.lot.material;
        if (material_id && (!mat || Number(mat.id) !== Number(material_id))) return;
        const key = mat ? mat.name : "Unknown";
        if (!processedByMaterial[key]) processedByMaterial[key] = { input_qty: 0, output_qty: 0 };
        processedByMaterial[key].input_qty += Number(b.input_qty || 0);
        if (b.lengthGrading) {
          const lg = b.lengthGrading;
          processedByMaterial[key].output_qty += [lg.long_qty, lg.medium_qty, lg.broken_qty, lg.small_broken_qty]
            .map((v) => Number(v) || 0).reduce((a, c) => a + c, 0);
        }
      });

      // --- Warehouse stock: live snapshot, not date-ranged ---
      const inventoryWhere = { ...plantWhere, is_deleted: false };
      if (material_id) inventoryWhere.material_id = material_id;

      const rawStockRows = await Inventory.findAll({
        where: { ...inventoryWhere, stage: "raw" },
        include: [{ model: MaterialMaster, as: "material", attributes: ["id", "name"] }],
      });
      const byProductStockRows = await Inventory.findAll({
        where: { ...inventoryWhere, stage: "by_product" },
        include: [{ model: MaterialMaster, as: "material", attributes: ["id", "name"] }],
      });

      const sumByMaterial = (invRows) => {
        const acc = {};
        invRows.forEach((r) => {
          const key = r.material ? r.material.name : "Unknown";
          acc[key] = (acc[key] || 0) + Number(r.balance_qty || 0);
        });
        return acc;
      };
      const rawStockByMaterial = sumByMaterial(rawStockRows);
      const byProductStockByMaterial = sumByMaterial(byProductStockRows);

      const fgRows = await FinishedGoods.findAll({
        where: { ...plantWhere, is_deleted: false, fg_status: { [Op.in]: ["ready", "aging"] } },
        include: [{ model: Packing, as: "packing", attributes: ["pack_size"] }],
      });
      const fgByPackSize = {};
      fgRows.forEach((r) => {
        const key = r.packing ? `${r.packing.pack_size}kg bags` : "Unknown pack size";
        fgByPackSize[key] = (fgByPackSize[key] || 0) + Number(r.qty || 0);
      });

      // --- Flatten everything into one table: [{ section, material, qty }] ---
      const toRows = (section, obj) => Object.entries(obj).map(([material, qty]) => ({ section, material, qty: Number(qty.toFixed ? qty.toFixed(2) : qty) }));

      const flatRows = [
        ...toRows("Inward", inwardByMaterial),
        ...Object.entries(processedByMaterial).flatMap(([material, v]) => ([
          { section: "Processed (input)", material, qty: Number(v.input_qty.toFixed(2)) },
          { section: "Processed (output)", material, qty: Number(v.output_qty.toFixed(2)) },
        ])),
        ...toRows("Warehouse Stock - Raw Material", rawStockByMaterial),
        ...toRows("Warehouse Stock - By-Product", byProductStockByMaterial),
        ...toRows("Warehouse Stock - Finished Goods", fgByPackSize),
      ];

      const summary = {
        total_inward_qty: Object.values(inwardByMaterial).reduce((a, b) => a + b, 0),
        total_processed_input_qty: Object.values(processedByMaterial).reduce((a, v) => a + v.input_qty, 0),
        total_processed_output_qty: Object.values(processedByMaterial).reduce((a, v) => a + v.output_qty, 0),
        total_raw_stock_qty: Object.values(rawStockByMaterial).reduce((a, b) => a + b, 0),
        total_by_product_stock_qty: Object.values(byProductStockByMaterial).reduce((a, b) => a + b, 0),
        total_finished_goods_stock_qty: Object.values(fgByPackSize).reduce((a, b) => a + b, 0),
      };

      if (format === "csv") {
        const csv = toCsv(flatRows, [
          { key: "section", label: "Section" },
          { key: "material", label: "Material / Category" },
          { key: "qty", label: "Qty (Qtl)" },
        ]);
        return sendCsv(res, `material-flow-${range.label}.csv`, csv);
      }

      res.status(200).json({
        success: true,
        period: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
        summary,
        rows: flatRows,
      });
    } catch (err) {
      next(err);
    }
  },
 
  // GET /api/reports/stock-report?warehouse_id=&date=YYYY-MM-DD
  // The Warehouse > Stock Report PDF: one day's stock per warehouse, split into raw material
  // and packed goods, with Opening / Inwards / Production-Repacking / Dispatch / Issue / Closing
  // in Qtl. Omit warehouse_id for the combined report across every warehouse.
  // Worked out by the same engine as the Inventory reports (controllers/inventoryReport.controller.js)
  // so every screen and PDF agrees. Opening / Closing / Bags are only available for today's date —
  // the PDF says so for any other date (this app keeps no stock ledger).
  stockReport: async (req, res, next) => {
    try {
      const spec = await buildWarehouseStockSpec(req.query || {});
      return renderTableReport(res, {
        ...spec,
        generatedBy: (req.user && (req.user.username || req.user.name || req.user.email)) || "",
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/reports/production-batch/:id/report
  // The Production Batch report PDF for one packed batch: the input materials and the warehouse
  // they were used from, the packed output and the warehouse it went into, rejected output, and
  // the stock before / closing after / now for each. Layout and data live in
  // helpers/productionBatchReport.helper.js. A batch that hasn't been packed yet has no report.
  productionReport: async (req, res, next) => {
    try {
      const spec = await buildBatchReportSpec(req.params.id);
      return renderTableReport(res, {
        ...spec,
        generatedBy: (req.user && (req.user.username || req.user.name || req.user.email)) || "",
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/reports/daily-outward-pdf?date=YYYY-MM-DD&plant_id=
  // "Daily Outward" logistics sheet — every outward (sales) truck for the
  // day, laid out like the mill's paper tracking sheet.
  // Sourced entirely from GateEntry (entry_type "sales") — NOT Dispatch.
  // Dispatch is being removed from this codebase, so nothing here (or in
  // dailyReportPdf below) reads from it any more.
  // G.P. No. is intentionally omitted. Location / Position / Unloading Date
  // come straight off the matching GateEntry row via Admin > Advisory
  // Trucks (advisory_location_note / advisory_position_note / advisory_date)
  // — a direct field read, not a guessed match, since the row itself IS
  // that gate entry now.
  // "MT" (Balance Weight, in metric tons) is strictly the weighbridge first
  // weighment minus second weighment (gross - tare) off the WeightSlip tied
  // to this exact gate entry (GateEntry.id === WeightSlip.gate_entry_id) —
  // never a manually recorded quantity. No matching weighbridge slip => "—".
  dailyOutwardPdf: async (req, res, next) => {
    try {
      const { date, plant_id } = req.query;
      const reportDate = date || new Date().toISOString().slice(0, 10);

      // Compares the calendar date the row is actually stored under (via
      // SQL DATE(), not a JS-Date UTC window) so this can't miss rows to a
      // server/DB timezone offset the way an ISO "Z" boundary comparison can.
      // A sales truck's "day" is whichever of entry/exit actually falls on
      // the requested date, so either counts as a match.
      const where = { is_deleted: false, entry_type: "sales" };
      if (plant_id) where.plant_id = plant_id;

      const gateEntries = await GateEntry.findAll({
        where: {
          [Op.and]: [
            where,
            {
              [Op.or]: [
                sequelize.where(sequelize.fn("DATE", sequelize.col("exit_time")), reportDate),
                sequelize.where(sequelize.fn("DATE", sequelize.col("entry_time")), reportDate),
              ],
            },
          ],
        },
        include: [
          { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
          { model: Driver, as: "driver", attributes: ["id", "name", "mobile"] },
          { model: Customer, as: "customer", attributes: ["id", "name"] },
          { model: MaterialMaster, as: "material", attributes: ["id", "name"] },
          { model: PlantMaster, as: "plant", attributes: ["id", "name"] },
          {
            model: GateEntrySalesOrder, as: "sales_orders", attributes: ["id"],
            include: [{ model: MaterialMaster, as: "material", attributes: ["id", "name"] }],
          },
        ],
        order: [[sequelize.fn("COALESCE", sequelize.col("exit_time"), sequelize.col("entry_time")), "ASC"]],
      });

      // Balance Weight: the weighbridge slip tied directly to this gate
      // entry — a real FK (WeightSlip.gate_entry_id), not a vehicle/day
      // guess, since every row here already IS one specific gate entry.
      const gateEntryIds = gateEntries.map((g) => g.id);
      const weighSlips = gateEntryIds.length
        ? await WeightSlip.findAll({ where: { is_deleted: false, gate_entry_id: { [Op.in]: gateEntryIds } } })
        : [];
      const balanceWeightByGateEntry = new Map();
      weighSlips.forEach((ws) => {
        if (ws.net_weight != null) balanceWeightByGateEntry.set(ws.gate_entry_id, ws.net_weight);
      });

      const materialNameFor = (ge) => {
        if (ge.material?.name) return ge.material.name;
        const names = [...new Set((ge.sales_orders || []).map((r) => r.material?.name).filter(Boolean))];
        return names.length ? names.join(", ") : "—";
      };

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="daily-outward-${reportDate}.pdf"`);

      const doc = new PDFDocument({ size: "A4", margin: 28, layout: "landscape" });
      doc.pipe(res);

      const headers = ["S.No", "Date", "Vehicle No.", "Item", "To", "Lot No.", "MT (Balance Wt.)", "Mill Name", "Party Name", "Location", "Position", "Unloading Date", "Driver Name"];
      const colWidths = [24, 50, 60, 42, 50, 42, 58, 52, 100, 78, 60, 58, 78];
      const startX = doc.page.margins.left;
      const tableWidth = colWidths.reduce((a, b) => a + b, 0);
      const rowHeight = 22;

      // Letterhead plant: whichever was explicitly filtered on, else the
      // first outward gate entry's own plant, else just the first plant on
      // record — same fallback chain resolveLetterheadPlant() above uses.
      const letterheadPlant = plant_id
        ? await PlantMaster.findOne({ where: { id: plant_id, is_deleted: false } })
        : gateEntries[0]?.plant || (await PlantMaster.findOne({ where: { is_deleted: false }, order: [["id", "ASC"]] }));

      const drawLetterhead = () => {
        if (letterheadPlant?.name) {
          doc.font("Helvetica-Bold").fontSize(18).text(letterheadPlant.name.toUpperCase(), { align: "center" });
          if (letterheadPlant.address) {
            doc.font("Helvetica-Bold").fontSize(8.5).text(`Address: ${letterheadPlant.address}`, { align: "center" });
          }
          doc.moveDown(0.3);
        }
        doc.font("Helvetica-Bold").fontSize(15).text(`Daily Outward Details-${reportDate}`, { align: "center" });
        doc.moveDown(0.6);
      };

      let y;
      const drawGridRow = (cells, { bold, header, redCols } = {}) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
        doc.rect(startX, y, tableWidth, rowHeight);
        if (header) doc.fillAndStroke("#DCE6F1", "#000");
        else doc.stroke();
        let x = startX;
        cells.forEach((cell, i) => {
          doc.fillColor(redCols && redCols.includes(i) && cell && cell !== "—" ? "#CC0000" : "#000");
          doc.text(String(cell ?? "—"), x + 3, y + 6, { width: colWidths[i] - 6, align: "center" });
          x += colWidths[i];
          if (i < cells.length - 1) doc.moveTo(x, y).lineTo(x, y + rowHeight).stroke();
        });
        doc.fillColor("#000");
        y += rowHeight;
      };

      const startNewPage = (isFirst) => {
        if (!isFirst) doc.addPage({ size: "A4", margin: 28, layout: "landscape" });
        drawLetterhead();
        y = doc.y;
        drawGridRow(headers, { bold: true, header: true });
      };

      startNewPage(true);

      gateEntries.forEach((ge, i) => {
        if (y + rowHeight > doc.page.height - doc.page.margins.bottom) startNewPage(false);
        const balanceWeightKg = balanceWeightByGateEntry.get(ge.id);
        const dateValue = ge.exit_time || ge.entry_time;
        drawGridRow(
          [
            i + 1,
            dateValue ? new Date(dateValue).toLocaleDateString("en-GB") : "—",
            ge.vehicle?.vehicle_no || "—",
            materialNameFor(ge),
            "—", // To — no destination field tracked against GateEntry in this system
            "—", // Lot No. — raw outward gate exits aren't tied to a source lot
            balanceWeightKg != null ? (Number(balanceWeightKg) / 1000).toFixed(2) : "—",
            ge.plant?.name || "—",
            ge.customer?.name || "—",
            ge.advisory_location_note || "—",
            ge.advisory_position_note || "—",
            ge.advisory_date || "—",
            ge.driver?.name || "—",
          ],
          { redCols: [10] }
        );
      });

      if (gateEntries.length === 0) {
        // Diagnostic, not a fallback data source: tells us whether this is
        // "no sales trucks on this date" (expected) vs "sales trucks exist
        // but none matched" (a real bug worth chasing further).
        const totalSalesEntries = await GateEntry.countAll?.() ?? await GateEntry.count({ where: { is_deleted: false, entry_type: "sales" } });
        doc.font("Helvetica").fontSize(10).text(
          `No outward (sales) trucks recorded for this date. (${totalSalesEntries} sales gate ${totalSalesEntries === 1 ? "entry" : "entries"} exist in total, across all dates — if that number looks wrong for what you expect, the entry/exit time on those records may not be what's expected.)`,
          startX, y + 10, { width: tableWidth }
        );
      }

      doc.moveDown(1.5);
      doc.font("Helvetica").fontSize(7.5).fillColor("#666").text(
        "G.P. No. is not shown. Location, Position and Unloading Date come from Admin > Advisory Trucks for this gate entry — \"—\" until an admin fills them in there. MT is the weighbridge Balance Weight (first weighment minus second weighment) for the weighbridge slip tied to this gate entry; it shows \"—\" when no weighbridge slip exists yet. Lot No. isn't tracked for outward gate exits.",
        { width: tableWidth }
      );

      doc.end();
    } catch (err) {
      next(err);
    }
  },

  // GET /api/reports/daily-report-pdf?date=YYYY-MM-DD&report_type=inward|outward|overall&plant_id=&warehouse_id=
  // Three PDF layouts (Inward report, Outward report, Overall inward/outward report), each with
  // the Gate Pass number per vehicle and every warehouse available as a filter. All the data and
  // layout code lives in helpers/dailyReport.helper.js.
  dailyReportPdf: async (req, res, next) => {
    try {
      const spec = await buildDailyReportSpec(req.query || {});
      return renderTableReport(res, {
        ...spec,
        generatedBy: (req.user && (req.user.username || req.user.name || req.user.email)) || "",
      });
    } catch (err) {
      next(err);
    }
  },
};