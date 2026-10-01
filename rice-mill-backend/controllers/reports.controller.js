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

      const buildRow = (batch) => {
        const lg = batch.lengthGrading;
        const output_qty = lg
          ? [lg.long_qty, lg.medium_qty, lg.broken_qty, lg.small_broken_qty].map((v) => Number(v) || 0).reduce((a, b) => a + b, 0)
          : null;
        const input_qty = Number(batch.input_qty) || 0;
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

      if (format === "csv") {
        const rows = await ProductionBatch.findAll({ where, include, order: [["production_date", "DESC"]] });
        const data = rows.map(buildRow);
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

      res.status(200).json({
        success: true,
        data: rows.map(buildRow),
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
  // Streams a PDF, one row per (material, pack size) — "Bulk" for raw stock
  // with no recorded bag size — with Opening/Inwards/Production-Repacking/
  // Dispatch/Issue/Closing, all in Qtl. Omit warehouse_id for the combined
  // report across every warehouse.
  //
  // IMPORTANT LIMITATION: this app has no stock-movement ledger (ins/outs
  // are only ever applied as balance updates, never logged as timestamped
  // events), so a true historical running balance can't be reconstructed
  // for a past date. Opening/Closing are only shown when the requested
  // date is today (Closing = the live balance; Opening = derived by
  // reversing today's movements out of it). For any other date, Inwards/
  // Production/Dispatch/Issue are still fully accurate (each is derived
  // straight from timestamped source rows), but Opening/Closing show "—"
  // with a footnote rather than a fabricated number.
  stockReport: async (req, res, next) => {
    try {
      const { warehouse_id, date } = req.query;
      const reportDate = date || new Date().toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      const isToday = reportDate === today;
      const dayStart = new Date(`${reportDate}T00:00:00.000Z`);
      const dayEnd = new Date(`${reportDate}T23:59:59.999Z`);

      let warehouse = null;
      let warehouseIds = [];
      if (warehouse_id) {
        warehouse = await WarehouseMaster.findOne({ where: { id: warehouse_id, is_deleted: false } });
        if (!warehouse) throw createError(404, "Warehouse not found");
        warehouseIds = [warehouse.id];
      } else {
        const all = await WarehouseMaster.findAll({ where: { is_deleted: false } });
        warehouseIds = all.map((w) => w.id);
      }

      const plant = await resolveLetterheadPlant(warehouse);

      // Rows keyed by material + pack size (bag size for raw, pack size for packed)
      const rowsByKey = new Map();
      const getRow = (materialId, materialName, packSize) => {
        const key = `${materialId}|${packSize}`;
        const existing = rowsByKey.get(key) || {
          material_id: materialId,
          material_name: materialName,
          pack_size: packSize,
          opening: 0,
          inwards: 0,
          production: 0,
          dispatch: 0,
          issue: 0,
          closing: 0,
        };
        rowsByKey.set(key, existing);
        return existing;
      };

      // ---- Live closing stock: raw (with bag size via Lot) ----
      const invRows = await Inventory.findAll({
        where: { is_deleted: false, stage: "raw", balance_qty: { [Op.gt]: 0 }, warehouse_id: { [Op.in]: warehouseIds } },
        include: [
          { model: MaterialMaster, as: "material", attributes: ["id", "name"] },
          { model: Lot, as: "lot", attributes: ["id", "bag_size"] },
        ],
      });
      for (const r of invRows) {
        const bagSize = r.lot?.bag_size != null ? Number(r.lot.bag_size) : null;
        const row = getRow(r.material_id, r.material?.name || `Material ${r.material_id}`, bagSize);
        row.closing += Number(r.balance_qty || 0);
      }

      // ---- Live closing stock: packed (Inventory fg-stage rows, labeled via Packing.pack_size) ----
      const fgInvRows = await Inventory.findAll({
        where: { is_deleted: false, stage: "fg", balance_qty: { [Op.gt]: 0 }, warehouse_id: { [Op.in]: warehouseIds } },
        include: [{ model: MaterialMaster, as: "material", attributes: ["id", "name"] }],
      });
      if (fgInvRows.length > 0) {
        const fgLotIds = [...new Set(fgInvRows.map((r) => r.lot_id).filter(Boolean))];
        const packingRows = fgLotIds.length
          ? await Packing.findAll({ where: { lot_id: { [Op.in]: fgLotIds }, is_deleted: false }, attributes: ["id", "lot_id", "material_id", "pack_size"] })
          : [];
        for (const r of fgInvRows) {
          const packing = packingRows.find((p) => Number(p.lot_id) === Number(r.lot_id) && (!p.material_id || Number(p.material_id) === Number(r.material_id)));
          const packSize = packing?.pack_size != null ? Number(packing.pack_size) : null;
          const row = getRow(r.material_id, r.material?.name || `Material ${r.material_id}`, packSize);
          row.closing += Number(r.balance_qty || 0);
        }
      }

      // ---- Inwards on this date: Lots unloaded into these warehouses ----
      const inwardLots = await Lot.findAll({
        where: {
          is_deleted: false,
          warehouse_id: { [Op.in]: warehouseIds },
          unloading_status: "completed",
          updated_at: { [Op.between]: [dayStart, dayEnd] },
        },
        include: [{ model: MaterialMaster, as: "material", attributes: ["id", "name"] }],
      });
      for (const lot of inwardLots) {
        const row = getRow(lot.material_id, lot.material?.name || `Material ${lot.material_id}`, lot.bag_size != null ? Number(lot.bag_size) : null);
        row.inwards += Number(lot.qty || 0);
      }

      // ---- Packing rows created on this date: Production (destination
      // warehouse, via FinishedGoods) and Issue (source ProductionBatch.warehouse_id) ----
      const packingToday = await Packing.findAll({
        where: { is_deleted: false, created_at: { [Op.between]: [dayStart, dayEnd] } },
        attributes: ["id", "material_id", "pack_size", "batch_id"],
      });
      if (packingToday.length > 0) {
        const batchIds = [...new Set(packingToday.map((p) => Number(p.batch_id)))];
        const batches = await ProductionBatch.findAll({ where: { id: { [Op.in]: batchIds } }, attributes: ["id", "warehouse_id"] });
        const sourceWarehouseByBatch = new Map(batches.map((b) => [b.id, b.warehouse_id]));

        const materialIds2 = [...new Set(packingToday.map((p) => Number(p.material_id)).filter(Boolean))];
        const materialRows2 = await MaterialMaster.findAll({ where: { id: { [Op.in]: materialIds2 } }, attributes: ["id", "name"] });
        const materialNameById2 = new Map(materialRows2.map((m) => [m.id, m.name]));

        const fgTodayForThesePackings = await FinishedGoods.findAll({
          where: { packing_id: { [Op.in]: packingToday.map((p) => p.id) }, is_deleted: false },
          attributes: ["id", "packing_id", "warehouse_id", "qty"],
        });
        const fgByPackingId = new Map(fgTodayForThesePackings.map((fg) => [Number(fg.packing_id), fg]));

        for (const p of packingToday) {
          const materialId = Number(p.material_id);
          if (!materialId) continue;
          const materialName = materialNameById2.get(materialId) || `Material ${materialId}`;
          const packSize = Number(p.pack_size);
          const fg = fgByPackingId.get(p.id);
          const qtyQtl = fg ? Number(fg.qty || 0) / 1000 : 0;

          if (fg && warehouseIds.includes(fg.warehouse_id)) {
            getRow(materialId, materialName, packSize).production += qtyQtl;
          }
          const sourceWarehouseId = sourceWarehouseByBatch.get(Number(p.batch_id));
          if (sourceWarehouseId && warehouseIds.includes(sourceWarehouseId)) {
            getRow(materialId, materialName, packSize).issue += qtyQtl;
          }
        }
      }

      // ---- Dispatch on this date: FinishedGoods that became 'dispatched' today ----
      const dispatchedFg = await FinishedGoods.findAll({
        where: {
          is_deleted: false,
          fg_status: "dispatched",
          warehouse_id: { [Op.in]: warehouseIds },
          updated_at: { [Op.between]: [dayStart, dayEnd] },
        },
        attributes: ["id", "packing_id", "qty"],
      });
      if (dispatchedFg.length > 0) {
        const packingIds3 = [...new Set(dispatchedFg.map((r) => Number(r.packing_id)))];
        const packingRows3 = await Packing.findAll({ where: { id: { [Op.in]: packingIds3 }, is_deleted: false }, attributes: ["id", "material_id", "pack_size"] });
        const packingById3 = new Map(packingRows3.map((p) => [p.id, p]));
        const materialIds3 = [...new Set(packingRows3.map((p) => Number(p.material_id)).filter(Boolean))];
        const materialRows3 = await MaterialMaster.findAll({ where: { id: { [Op.in]: materialIds3 } }, attributes: ["id", "name"] });
        const materialNameById3 = new Map(materialRows3.map((m) => [m.id, m.name]));

        for (const fg of dispatchedFg) {
          const packing = packingById3.get(Number(fg.packing_id));
          if (!packing || !packing.material_id) continue;
          const materialId = Number(packing.material_id);
          const row = getRow(materialId, materialNameById3.get(materialId) || `Material ${materialId}`, Number(packing.pack_size));
          row.dispatch += Number(fg.qty || 0) / 1000;
        }
      }

      // ---- Opening stock: only derivable for today (see limitation note above) ----
      if (isToday) {
        for (const row of rowsByKey.values()) {
          row.opening = row.closing - row.inwards - row.production + row.issue + row.dispatch;
        }
      }

      const rows = Array.from(rowsByKey.values())
        .filter((r) =>
          Math.abs(r.opening) > 0.0005 ||
          Math.abs(r.closing) > 0.0005 ||
          Math.abs(r.inwards) > 0.0005 ||
          Math.abs(r.production) > 0.0005 ||
          Math.abs(r.dispatch) > 0.0005 ||
          Math.abs(r.issue) > 0.0005
        )
        .sort((a, b) => a.material_name.localeCompare(b.material_name) || (a.pack_size ?? -1) - (b.pack_size ?? -1));

      // ---- Render PDF ----
      const title = warehouse ? `${warehouse.name.toUpperCase()} STOCK REPORT` : "OVERALL STOCK REPORT";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="stock-report-${warehouse ? warehouse.warehouse_code : "overall"}-${reportDate}.pdf"`
      );

      const doc = new PDFDocument({ size: "A4", margin: 45, layout: "landscape" });
      doc.pipe(res);

      const headers = ["S.No", "Material", "Packing Size", "Bags", "Opening Stock", "Inwards", "Production/Repacking", "Dispatch", "Issue", "Closing Stock"];
      const colWidths = [28, 128, 62, 50, 68, 62, 96, 62, 62, 70];
      const startX = doc.page.margins.left;
      const tableWidth = colWidths.reduce((a, b) => a + b, 0);
      const rowHeight = 20;

      const drawLetterhead = () => {
        doc.font("Helvetica-Bold").fontSize(16).text(plant ? plant.name.toUpperCase() : "RICE MILL ERP", { align: "center" });
        if (plant && plant.address) doc.font("Helvetica").fontSize(9).text(plant.address, { align: "center" });
        doc.moveDown(0.5);
        doc.font("Helvetica-Bold").fontSize(13).text(title, { align: "center", underline: true });
        doc.moveDown(0.3);
        doc.font("Helvetica").fontSize(10).text(`Date: ${reportDate}`, { align: "center" });
        doc.moveDown(1);
      };

      const bagsDisplay = (r) => {
        if (r.pack_size == null || !isToday) return "—";
        return Math.floor((r.closing * 1000) / r.pack_size + 0.0001);
      };

      let y;
      const drawGridRow = (cells, bold) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
        doc.rect(startX, y, tableWidth, rowHeight).stroke();
        let x = startX;
        cells.forEach((cell, i) => {
          doc.text(String(cell), x + 3, y + 6, { width: colWidths[i] - 6, align: i === 1 ? "left" : "center" });
          x += colWidths[i];
          if (i < cells.length - 1) doc.moveTo(x, y).lineTo(x, y + rowHeight).stroke();
        });
        y += rowHeight;
      };

      const startNewPage = (isFirst) => {
        if (!isFirst) doc.addPage({ size: "A4", margin: 45, layout: "landscape" });
        drawLetterhead();
        y = doc.y;
        drawGridRow(headers, true);
      };

      startNewPage(true);

      rows.forEach((r, i) => {
        if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
          startNewPage(false);
        }
        drawGridRow([
          i + 1,
          r.material_name,
          r.pack_size != null ? `${r.pack_size} kg` : "Bulk",
          bagsDisplay(r),
          isToday ? r.opening.toFixed(3) : "—",
          r.inwards.toFixed(3),
          r.production.toFixed(3),
          r.dispatch.toFixed(3),
          r.issue.toFixed(3),
          isToday ? r.closing.toFixed(3) : "—",
        ]);
      });

      if (!isToday) {
        doc.moveDown(1.5);
        doc.font("Helvetica").fontSize(8).fillColor("#666").text(
          "Note: Opening Stock and Closing Stock (and Bags, which is derived from Closing Stock) are only available for today's date — this system does not yet keep a full stock-movement ledger needed to reconstruct a historical running balance for past dates. Inwards, Production/Repacking, Dispatch and Issue for the selected date are accurate.",
          { width: tableWidth }
        );
      }

      doc.end();
    } catch (err) {
      next(err);
    }
  },

  // GET /api/reports/production-batch/:id/report
  // Streams a PDF for one finalized (packed) production batch: Shift,
  // Material, Bags, Size, Actual (Qtl). "Shift" and "Approx in tank" have
  // no equivalent anywhere in this system's data, so they're left as blank
  // columns for manual fill-in (matching the paper form) rather than guessed.
  productionReport: async (req, res, next) => {
    try {
      const batch = await ProductionBatch.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!batch) throw createError(404, "Production batch not found");
      if (batch.batch_status === "pending") {
        throw createError(400, "This batch hasn't been packed yet — finalize packing first to generate its production report");
      }

      const packingRows = await Packing.findAll({
        where: { batch_id: batch.id, is_deleted: false },
        attributes: ["id", "material_id", "pack_size", "bag_count"],
        order: [["created_at", "ASC"]],
      });

      const materialIds = [...new Set(packingRows.map((p) => Number(p.material_id)).filter(Boolean))];
      const materialRows = await MaterialMaster.findAll({ where: { id: { [Op.in]: materialIds } }, attributes: ["id", "name"] });
      const materialNameById = new Map(materialRows.map((m) => [m.id, m.name]));

      const fgRows = await FinishedGoods.findAll({
        where: { packing_id: { [Op.in]: packingRows.map((p) => p.id) }, is_deleted: false },
        attributes: ["id", "packing_id", "qty"],
      });
      const fgByPackingId = new Map(fgRows.map((fg) => [Number(fg.packing_id), fg]));

      const warehouse = batch.warehouse_id
        ? await WarehouseMaster.findOne({ where: { id: batch.warehouse_id, is_deleted: false } })
        : null;
      const plant = await resolveLetterheadPlant(warehouse);

      const lines = packingRows.map((p) => {
        const materialId = p.material_id ? Number(p.material_id) : null;
        const fg = fgByPackingId.get(p.id);
        return {
          material_name: materialId ? (materialNameById.get(materialId) || `Material ${materialId}`) : "—",
          bag_count: p.bag_count,
          pack_size: Number(p.pack_size),
          actual_Qtl: fg ? Math.round((Number(fg.qty || 0) / 1000) * 1000) / 1000 : 0,
        };
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="production-report-${batch.batch_no}.pdf"`);

      const doc = new PDFDocument({ size: "A4", margin: 50 });
      doc.pipe(res);

      doc.font("Helvetica-Bold").fontSize(16).text(plant ? plant.name.toUpperCase() : "RICE MILL ERP", { align: "center" });
      if (plant && plant.address) doc.font("Helvetica").fontSize(9).text(plant.address, { align: "center" });
      doc.moveDown(0.5);
      doc.font("Helvetica-Bold").fontSize(13).text("PRODUCTION REPORT", { align: "center", underline: true });
      doc.moveDown(1);

      doc.font("Helvetica").fontSize(10);
      const infoY = doc.y;
      doc.text(`Date: ${batch.production_date || "-"}`, doc.page.margins.left, infoY);
      doc.text(`Batch No: ${batch.batch_no}`, doc.page.margins.left + 260, infoY);
      doc.moveDown(1.5);

      // "Approx in Tank" isn't a literal tank reading this system has —
      // it's filled with the nominal quantity implied by pack size x bag
      // count, which can differ slightly from "Actual" when a packing was
      // recorded with a qty_override (e.g. a real weighed value that
      // didn't land exactly on a round bag-size multiple).
      const headers = ["Shift", "Material", "Bags", "Size (kg)", "Actual (Qtl)", "Approx (Qtl)"];
      const colWidths = [55, 150, 60, 70, 90, 90];
      const startX = doc.page.margins.left;
      const tableWidth = colWidths.reduce((a, b) => a + b, 0);
      const rowHeight = 22;
      let y = doc.y;

      const drawGridRow = (cells, bold) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
        doc.rect(startX, y, tableWidth, rowHeight).stroke();
        let x = startX;
        cells.forEach((cell, i) => {
          doc.text(String(cell), x + 4, y + 6, { width: colWidths[i] - 8, align: i >= 2 ? "center" : "left" });
          x += colWidths[i];
          if (i < cells.length - 1) doc.moveTo(x, y).lineTo(x, y + rowHeight).stroke();
        });
        y += rowHeight;
      };

      drawGridRow(headers, true);

      let totalBags = 0;
      let totalActual = 0;
      let totalApprox = 0;
      lines.forEach((l) => {
        const approxQtl = Math.round(((Number(l.pack_size) || 0) * (Number(l.bag_count) || 0) / 1000) * 1000) / 1000;
        drawGridRow(["", l.material_name, l.bag_count, l.pack_size, l.actual_Qtl.toFixed(3), approxQtl.toFixed(3)]);
        totalBags += Number(l.bag_count || 0);
        totalActual += l.actual_Qtl;
        totalApprox += approxQtl;
      });

      drawGridRow(["", "TOTAL", totalBags, "", totalActual.toFixed(3), totalApprox.toFixed(3)], true);

      doc.moveDown(1.5);
      doc.font("Helvetica").fontSize(8).fillColor("#666").text(
        "Note: \"Shift\" is not tracked by this system and is left blank for manual entry. \"Approx\" is the nominal quantity from pack size x bag count; \"Actual\" is the recorded packed quantity (they match unless a manual override was used when packing).",
        { width: tableWidth }
      );

      doc.end();
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

  // GET /api/reports/daily-report-pdf?date=YYYY-MM-DD&plant_id=
  // "Daily Report" — per Plant (each PlantMaster row is treated as one
  // company/mill, matching the paper report's separate "R.D. INDUSTRIES" /
  // "VENUS CONSUMERS PRIVATE LIMITED" sections), an Outward table (outward
  // sales trucks) and an Inward table (Purchase — vehicles that came in
  // against a Purchase Order), per the brief: "inward means vehicle which
  // came in as in purchase order and outward means the vehicle which moves
  // out for sales order". Records with no plant_id set land in a separate
  // "Unassigned" section instead of being dropped (see below).
  // Outward is sourced entirely from GateEntry (entry_type "sales") — NOT
  // Dispatch, which is being removed from this codebase.
  // Balance Weight = weighbridge first weighment minus second weighment
  // (gross - tare) — strictly a weighbridge figure, never a manually
  // recorded quantity. For Inward this is Purchase.weightSlip directly; for
  // Outward it's the WeightSlip tied straight to that gate entry
  // (WeightSlip.gate_entry_id) — a real FK, not a guessed match, since each
  // Outward row here already IS one specific gate entry. No matching slip
  // means "—".
  // G.P. No. is omitted.
  dailyReportPdf: async (req, res, next) => {
    try {
      const { date, plant_id } = req.query;
      const reportDate = date || new Date().toISOString().slice(0, 10);

      // SQL DATE() comparison (not a JS-Date UTC window) — see dailyOutwardPdf
      // above for why: it can't miss rows to a server/DB timezone offset.
      const exitOrEntryDateMatch = {
        [Op.or]: [
          sequelize.where(sequelize.fn("DATE", sequelize.col("exit_time")), reportDate),
          sequelize.where(sequelize.fn("DATE", sequelize.col("entry_time")), reportDate),
        ],
      };

      const plants = await PlantMaster.findAll({
        where: { is_deleted: false, ...(plant_id ? { id: plant_id } : {}) },
        order: [["id", "ASC"]],
      });

      // ---- Outward (GateEntry, entry_type "sales") for every plant ----
      const outwardEntries = await GateEntry.findAll({
        where: { [Op.and]: [{ is_deleted: false, entry_type: "sales" }, exitOrEntryDateMatch] },
        include: [
          { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
          { model: Customer, as: "customer", attributes: ["id", "name"] },
          { model: MaterialMaster, as: "material", attributes: ["id", "name"] },
          {
            model: GateEntrySalesOrder, as: "sales_orders", attributes: ["id"],
            include: [{ model: MaterialMaster, as: "material", attributes: ["id", "name"] }],
          },
        ],
      });
      const outwardMaterialFor = (ge) => {
        if (ge.material?.name) return ge.material.name;
        const names = [...new Set((ge.sales_orders || []).map((r) => r.material?.name).filter(Boolean))];
        return names.length ? names.join(", ") : "—";
      };

      // Balance Weight: the weighbridge slip tied directly to this gate
      // entry (real FK) — no vehicle/day guessing needed since each Outward
      // row already is one specific gate entry.
      const outwardGateEntryIds = outwardEntries.map((g) => g.id);
      const outwardWeighSlips = outwardGateEntryIds.length
        ? await WeightSlip.findAll({ where: { is_deleted: false, gate_entry_id: { [Op.in]: outwardGateEntryIds } } })
        : [];
      const balanceWeightByGateEntry = new Map();
      outwardWeighSlips.forEach((ws) => {
        if (ws.net_weight != null) balanceWeightByGateEntry.set(ws.gate_entry_id, ws.net_weight);
      });

      // ---- Inward (Purchase) for every plant, one query ----
      const purchases = await Purchase.findAll({
        where: { is_deleted: false, purchase_date: reportDate },
        include: [
          {
            model: GateEntry, as: "gateEntry", attributes: ["id", "vendor_id", "vehicle_id", "material_id"],
            include: [
              { model: Vendor, as: "vendor", attributes: ["id", "name"] },
              { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
              { model: MaterialMaster, as: "material", attributes: ["id", "name"] },
            ],
          },
          { model: WeightSlip, as: "weightSlip", attributes: ["id", "gross_weight", "tare_weight"] },
        ],
      });
      const purchaseIds = purchases.map((p) => p.id);
      const inwardLots = purchaseIds.length
        ? await Lot.findAll({ where: { purchase_id: { [Op.in]: purchaseIds }, is_deleted: false }, attributes: ["id", "purchase_id", "lot_no", "accepted_bags"] })
        : [];
      const lotsByPurchaseId = new Map();
      inwardLots.forEach((l) => {
        const list = lotsByPurchaseId.get(l.purchase_id) || [];
        list.push(l);
        lotsByPurchaseId.set(l.purchase_id, list);
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="daily-report-${reportDate}.pdf"`);

      const doc = new PDFDocument({ size: "A4", margin: 30, layout: "landscape" });
      doc.pipe(res);

      const headers = ["S NO", "RST NO", "ITEM", "PARTY NAME", "VEHICLE NO.", "BALANCE\nWEIGHT", "BAGS", "LOT NO", "REMARK"];
      const colWidths = [30, 50, 100, 170, 75, 70, 45, 70, 100];
      const startX = doc.page.margins.left;
      const tableWidth = colWidths.reduce((a, b) => a + b, 0);
      const rowHeight = 20;
      const headerRowHeight = 28;
      let y;
      let firstPage = true;

      const ensureSpace = (needed) => {
        if (y + needed > doc.page.height - doc.page.margins.bottom) {
          doc.addPage({ size: "A4", margin: 30, layout: "landscape" });
          y = doc.page.margins.top;
        }
      };

      const drawGridRow = (cells, { bold, header, h } = {}) => {
        const rh = h || rowHeight;
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
        doc.rect(startX, y, tableWidth, rh);
        if (header) doc.fillAndStroke("#F4B183", "#000"); // matches the orange-ish section banner in the source sheet
        else doc.stroke();
        doc.fillColor("#000");
        let x = startX;
        cells.forEach((cell, i) => {
          doc.text(String(cell ?? "—"), x + 3, y + (rh - 9) / 2, { width: colWidths[i] - 6, align: i === 2 || i === 3 ? "left" : "center" });
          x += colWidths[i];
          if (i < cells.length - 1) doc.moveTo(x, y).lineTo(x, y + rh).stroke();
        });
        y += rh;
      };

      const drawSectionBanner = (text) => {
        ensureSpace(24);
        doc.rect(startX, y, tableWidth, 22).fillAndStroke("#F4B183", "#000");
        doc.fillColor("#000").font("Helvetica-Bold").fontSize(11).text(text, startX, y + 5, { width: tableWidth, align: "center" });
        y += 22;
      };

      const drawTable = (rows) => {
        ensureSpace(headerRowHeight);
        drawGridRow(headers, { bold: true, header: true, h: headerRowHeight });
        if (rows.length === 0) {
          ensureSpace(rowHeight);
          drawGridRow(["", "", "(none)", "", "", "", "", "", ""], {});
        }
        rows.forEach((r) => {
          ensureSpace(rowHeight);
          drawGridRow(r);
        });
        // TOTAL row
        const totalWeight = rows.reduce((s, r) => s + (Number(r[5]) || 0), 0);
        const totalBags = rows.reduce((s, r) => s + (Number(r[6]) || 0), 0);
        ensureSpace(rowHeight);
        drawGridRow(["", "", "", "", "TOTAL", totalWeight ? totalWeight.toFixed(0) : "—", totalBags || "—", "", ""], { bold: true });
        y += 10;
      };

      // Guard against the report silently showing nothing: plant_id is an
      // optional field on GateEntry/Purchase, so most records in a system
      // that hasn't been using multi-plant tagging will have it as null and
      // would otherwise never match any plant.id === strict-equality check
      // below. Anything that doesn't match one of the plants being shown
      // gets its own "Unassigned" section instead of vanishing — but only
      // when the report isn't already scoped to one explicit plant_id.
      const matchedPlantIds = new Set(plants.map((p) => Number(p.id)));
      const unassignedOutward = outwardEntries.filter((g) => !matchedPlantIds.has(Number(g.plant_id)));
      const unassignedPurchases = purchases.filter((p) => !matchedPlantIds.has(Number(p.plant_id)));
      const sections = plants.map((p) => ({ id: p.id, name: p.name.toUpperCase() }));
      if (!plant_id && (unassignedOutward.length > 0 || unassignedPurchases.length > 0)) {
        sections.push({ id: null, name: "UNASSIGNED / NO PLANT SET" });
      }

      for (const section of sections) {
        ensureSpace(60);
        if (!firstPage) doc.moveDown(0.5);
        firstPage = false;

        doc.font("Helvetica").fontSize(10).text(`Plant Date - ${reportDate}`, startX, y, { width: tableWidth, align: "center" });
        y = doc.y + 4;
        doc.font("Helvetica-Bold").fontSize(15).text(section.name, startX, y, { width: tableWidth, align: "center" });
        y = doc.y + 8;

        drawSectionBanner("Outward Details");
        const sectionOutward = section.id != null
          ? outwardEntries.filter((g) => Number(g.plant_id) === Number(section.id))
          : unassignedOutward;
        const outwardRows = sectionOutward.map((ge) => {
          // Balance Weight = first weighment - second weighment off the
          // weighbridge slip tied directly to this gate entry. No fallback
          // to any manually recorded quantity — per the brief, this column
          // must be the actual weighbridge balance or nothing.
          const balanceWeight = balanceWeightByGateEntry.get(ge.id);
          return [
            ge.id, ge.id, outwardMaterialFor(ge), ge.customer?.name || "—",
            ge.vehicle?.vehicle_no || "—", balanceWeight != null ? Number(balanceWeight).toFixed(0) : "—",
            "—", // Bags — not tracked against a raw outward gate exit in this system
            "—", // Lot No. — not tracked against a raw outward gate exit in this system
            ge.challan_no || "—",
          ];
        });
        drawTable(outwardRows);

        drawSectionBanner("Inward Details");
        const sectionPurchases = section.id != null
          ? purchases.filter((p) => Number(p.plant_id) === Number(section.id))
          : unassignedPurchases;
        const inwardRows = sectionPurchases.map((p) => {
          const lots = lotsByPurchaseId.get(p.id) || [];
          const bags = lots.reduce((s, l) => s + (l.accepted_bags || 0), 0);
          const lotNo = lots.map((l) => l.lot_no).join(", ") || "—";
          // Same rule as Outward: Balance Weight is strictly gross - tare
          // off this purchase's weighbridge slip — no fallback to
          // Purchase.final_qty (the negotiated/accepted qty, not a weighment).
          const balanceWeight = p.weightSlip
            ? Number(p.weightSlip.gross_weight || 0) - Number(p.weightSlip.tare_weight || 0)
            : null;
          return [
            p.id, p.id, p.gateEntry?.material?.name || "—", p.gateEntry?.vendor?.name || "—",
            p.gateEntry?.vehicle?.vehicle_no || "—", balanceWeight != null ? balanceWeight.toFixed(0) : "—", bags || "—", lotNo,
            "—",
          ];
        });
        drawTable(inwardRows);

        y += 10;
      }

      if (sections.length === 0) {
        doc.font("Helvetica").fontSize(10).text("No plants configured, and no unassigned outward/inward records for this date.", startX, doc.page.margins.top);
      }

      doc.moveDown(1);
      doc.font("Helvetica").fontSize(7.5).fillColor("#666").text(
        "G.P. No. is not shown. RST No. is this system's internal record id (GateEntry id for Outward rows, Purchase id for Inward rows) — the source sheet's RST numbering isn't tracked separately here. Balance Weight is strictly the weighbridge net weight (first weighment - second weighment, i.e. gross - tare) for a matching weighment; it shows \"—\" when no weighbridge slip could be matched, rather than falling back to a manually recorded quantity. Outward Remark shows the Challan No. Bags and Lot No. aren't tracked against a raw outward gate exit in this system. Records with no plant assigned are grouped under \"Unassigned / No Plant Set\" rather than omitted.",
        { width: tableWidth }
      );

      doc.end();
    } catch (err) {
      next(err);
    }
  },
};