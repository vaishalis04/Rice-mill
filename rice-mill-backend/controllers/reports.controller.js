const createError = require("http-errors");
const { Op } = require("sequelize");
const PDFDocument = require("pdfkit");
const {
  GateEntry, Vehicle, Driver, Vendor, MaterialMaster, PlantMaster,
  ProductionBatch, Lot, LengthGrading, Purchase, Inventory, FinishedGoods, Packing,
  WarehouseMaster,
} = require("../models/index");
const { toCsv, sendCsv } = require("../helpers/csv");

// Day-wise, shift-wise, MIS, cycle/process-time reports (Module 23)
// Every endpoint returns plain JSON by default; add ?format=csv to any of them
// to get the same rows as a downloadable CSV file instead (what the FE's
// "Export to CSV" button calls). stockReport / productionReport below are
// PDF-only (pdfkit), matching the paper forms this mill already uses.

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
          { key: "expected_qty", label: "Expected Qty (Tons)" },
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
          { key: "input_qty", label: "Input Qty (Tons)" },
          { key: "output_qty", label: "Output Qty (Tons)" },
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
          { key: "qty", label: "Qty (Tons)" },
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
  // Dispatch/Issue/Closing, all in tons. Omit warehouse_id for the combined
  // report across every warehouse.
  //
  // IMPORTANT LIMITATION: this app has no stock-movement ledger (ins/outs are
  // only ever applied as balance updates, never logged as timestamped
  // events), so a true historical running balance can't be reconstructed for
  // a past date. Opening/Closing are only shown when the requested date is
  // today (Closing = the live balance; Opening = derived by reversing
  // today's movements out of it). For any other date, Inwards/Production/
  // Dispatch/Issue are still fully accurate (each is derived straight from
  // timestamped source rows), but Opening/Closing show "—" with a footnote
  // rather than a fabricated number.
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

      // ---- Live closing stock: packed (via FinishedGoods -> Packing -> Lot) ----
      const fgRowsLive = await FinishedGoods.findAll({
        where: { is_deleted: false, fg_status: { [Op.ne]: "dispatched" }, warehouse_id: { [Op.in]: warehouseIds } },
        attributes: ["id", "packing_id", "qty"],
      });
      if (fgRowsLive.length > 0) {
        const packingIds = [...new Set(fgRowsLive.map((r) => Number(r.packing_id)))];
        const packingRows = await Packing.findAll({ where: { id: { [Op.in]: packingIds }, is_deleted: false }, attributes: ["id", "lot_id", "pack_size"] });
        const packingById = new Map(packingRows.map((p) => [p.id, p]));
        const lotIds = [...new Set(packingRows.map((p) => p.lot_id).filter(Boolean))];
        const lotRows = await Lot.findAll({ where: { id: { [Op.in]: lotIds } }, attributes: ["id", "material_id"] });
        const materialIdByLotId = new Map(lotRows.map((l) => [l.id, Number(l.material_id)]));
        const materialIds = [...new Set(lotRows.map((l) => Number(l.material_id)))];
        const materialRows = await MaterialMaster.findAll({ where: { id: { [Op.in]: materialIds } }, attributes: ["id", "name"] });
        const materialNameById = new Map(materialRows.map((m) => [m.id, m.name]));

        for (const fg of fgRowsLive) {
          const packing = packingById.get(Number(fg.packing_id));
          if (!packing) continue;
          const materialId = materialIdByLotId.get(Number(packing.lot_id));
          if (!materialId) continue;
          const row = getRow(materialId, materialNameById.get(materialId) || `Material ${materialId}`, Number(packing.pack_size));
          row.closing += Number(fg.qty || 0) / 1000;
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
      // warehouse) and Issue (source ProductionBatch.warehouse_id) ----
      const packingToday = await Packing.findAll({
        where: { is_deleted: false, created_at: { [Op.between]: [dayStart, dayEnd] } },
        attributes: ["id", "lot_id", "pack_size", "batch_id"],
      });
      if (packingToday.length > 0) {
        const batchIds = [...new Set(packingToday.map((p) => Number(p.batch_id)))];
        const batches = await ProductionBatch.findAll({ where: { id: { [Op.in]: batchIds } }, attributes: ["id", "warehouse_id"] });
        const sourceWarehouseByBatch = new Map(batches.map((b) => [b.id, b.warehouse_id]));

        const lotIds2 = [...new Set(packingToday.map((p) => p.lot_id).filter(Boolean))];
        const lotRows2 = await Lot.findAll({ where: { id: { [Op.in]: lotIds2 } }, attributes: ["id", "material_id"] });
        const materialIdByLotId2 = new Map(lotRows2.map((l) => [l.id, Number(l.material_id)]));
        const materialIds2 = [...new Set(lotRows2.map((l) => Number(l.material_id)))];
        const materialRows2 = await MaterialMaster.findAll({ where: { id: { [Op.in]: materialIds2 } }, attributes: ["id", "name"] });
        const materialNameById2 = new Map(materialRows2.map((m) => [m.id, m.name]));

        const fgTodayForThesePackings = await FinishedGoods.findAll({
          where: { packing_id: { [Op.in]: packingToday.map((p) => p.id) }, is_deleted: false },
          attributes: ["id", "packing_id", "warehouse_id", "qty"],
        });
        const fgByPackingId = new Map(fgTodayForThesePackings.map((fg) => [Number(fg.packing_id), fg]));

        for (const p of packingToday) {
          const materialId = materialIdByLotId2.get(Number(p.lot_id));
          if (!materialId) continue;
          const materialName = materialNameById2.get(materialId) || `Material ${materialId}`;
          const packSize = Number(p.pack_size);
          const fg = fgByPackingId.get(p.id);
          const qtyTons = fg ? Number(fg.qty || 0) / 1000 : 0;

          if (fg && warehouseIds.includes(fg.warehouse_id)) {
            getRow(materialId, materialName, packSize).production += qtyTons;
          }
          const sourceWarehouseId = sourceWarehouseByBatch.get(Number(p.batch_id));
          if (sourceWarehouseId && warehouseIds.includes(sourceWarehouseId)) {
            getRow(materialId, materialName, packSize).issue += qtyTons;
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
        const packingRows3 = await Packing.findAll({ where: { id: { [Op.in]: packingIds3 }, is_deleted: false }, attributes: ["id", "lot_id", "pack_size"] });
        const packingById3 = new Map(packingRows3.map((p) => [p.id, p]));
        const lotIds3 = [...new Set(packingRows3.map((p) => p.lot_id).filter(Boolean))];
        const lotRows3 = await Lot.findAll({ where: { id: { [Op.in]: lotIds3 } }, attributes: ["id", "material_id"] });
        const materialIdByLotId3 = new Map(lotRows3.map((l) => [l.id, Number(l.material_id)]));
        const materialIds3 = [...new Set(lotRows3.map((l) => Number(l.material_id)))];
        const materialRows3 = await MaterialMaster.findAll({ where: { id: { [Op.in]: materialIds3 } }, attributes: ["id", "name"] });
        const materialNameById3 = new Map(materialRows3.map((m) => [m.id, m.name]));

        for (const fg of dispatchedFg) {
          const packing = packingById3.get(Number(fg.packing_id));
          if (!packing) continue;
          const materialId = materialIdByLotId3.get(Number(packing.lot_id));
          if (!materialId) continue;
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

      const doc = new PDFDocument({ size: "A4", margin: 40, layout: "landscape" });
      doc.pipe(res);

      doc.fontSize(16).text(plant ? plant.name.toUpperCase() : "RICE MILL ERP", { align: "center" });
      if (plant && plant.address) doc.fontSize(9).text(plant.address, { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(13).text(title, { align: "center", underline: true });
      doc.moveDown(0.3);
      doc.fontSize(10).text(`Date: ${reportDate}`, { align: "center" });
      doc.moveDown(1);

      const headers = ["S.No", "Material", "Packing Size", "Opening Stock", "Inwards", "Production/Repacking", "Dispatch", "Issue", "Closing Stock"];
      const colWidths = [35, 150, 90, 90, 80, 130, 80, 80, 90];
      const startX = doc.page.margins.left;
      let y = doc.y;
      const tableWidth = colWidths.reduce((a, b) => a + b, 0);

      const drawRow = (cells) => {
        let x = startX;
        doc.fontSize(9);
        cells.forEach((cell, i) => {
          doc.text(String(cell), x, y, { width: colWidths[i], align: i === 1 ? "left" : "center" });
          x += colWidths[i];
        });
        y += 18;
      };

      doc.font("Helvetica-Bold");
      drawRow(headers);
      doc.moveTo(startX, y - 4).lineTo(startX + tableWidth, y - 4).stroke();
      doc.font("Helvetica");

      rows.forEach((r, i) => {
        if (y > doc.page.height - doc.page.margins.bottom - 20) {
          doc.addPage({ size: "A4", margin: 40, layout: "landscape" });
          y = doc.y;
        }
        drawRow([
          i + 1,
          r.material_name,
          r.pack_size != null ? `${r.pack_size} kg` : "Bulk",
          isToday ? r.opening.toFixed(3) : "—",
          r.inwards.toFixed(3),
          r.production.toFixed(3),
          r.dispatch.toFixed(3),
          r.issue.toFixed(3),
          isToday ? r.closing.toFixed(3) : "—",
        ]);
      });

      if (!isToday) {
        doc.moveDown(2);
        doc.fontSize(8).fillColor("#666").text(
          "Note: Opening Stock and Closing Stock are only available for today's date — this system does not yet keep a full stock-movement ledger needed to reconstruct a historical running balance for past dates. Inwards, Production/Repacking, Dispatch and Issue for the selected date are accurate.",
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
  // Material, Bags, Size, Actual (tons). "Shift" and "Approx in tank" have
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
        attributes: ["id", "lot_id", "pack_size", "bag_count"],
        order: [["created_at", "ASC"]],
      });

      const lotIds = [...new Set(packingRows.map((p) => p.lot_id).filter(Boolean))];
      const lotRows = await Lot.findAll({ where: { id: { [Op.in]: lotIds } }, attributes: ["id", "material_id"] });
      const materialIdByLotId = new Map(lotRows.map((l) => [l.id, Number(l.material_id)]));
      const materialIds = [...new Set(lotRows.map((l) => Number(l.material_id)))];
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
        const materialId = materialIdByLotId.get(Number(p.lot_id));
        const fg = fgByPackingId.get(p.id);
        return {
          material_name: materialNameById.get(materialId) || (materialId ? `Material ${materialId}` : "—"),
          bag_count: p.bag_count,
          pack_size: Number(p.pack_size),
          actual_tons: fg ? Math.round((Number(fg.qty || 0) / 1000) * 1000) / 1000 : 0,
        };
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="production-report-${batch.batch_no}.pdf"`);

      const doc = new PDFDocument({ size: "A4", margin: 50 });
      doc.pipe(res);

      doc.fontSize(16).text(plant ? plant.name.toUpperCase() : "RICE MILL ERP", { align: "center" });
      if (plant && plant.address) doc.fontSize(9).text(plant.address, { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(13).text("PRODUCTION REPORT", { align: "center", underline: true });
      doc.moveDown(1);

      doc.fontSize(10);
      const infoY = doc.y;
      doc.text(`Date: ${batch.production_date || "-"}`, doc.page.margins.left, infoY);
      doc.text(`Batch No: ${batch.batch_no}`, doc.page.margins.left + 260, infoY);
      doc.moveDown(1.5);

      const headers = ["Shift", "Material", "Bags", "Size (kg)", "Actual (Tons)", "Approx in Tank"];
      const colWidths = [55, 150, 60, 70, 90, 100];
      const startX = doc.page.margins.left;
      let y = doc.y;
      const tableWidth = colWidths.reduce((a, b) => a + b, 0);

      const drawRow = (cells) => {
        let x = startX;
        doc.fontSize(9);
        cells.forEach((cell, i) => {
          doc.text(String(cell), x, y, { width: colWidths[i], align: i >= 2 ? "center" : "left" });
          x += colWidths[i];
        });
        y += 20;
      };

      doc.font("Helvetica-Bold");
      drawRow(headers);
      doc.moveTo(startX, y - 4).lineTo(startX + tableWidth, y - 4).stroke();
      doc.font("Helvetica");

      let totalBags = 0;
      let totalActual = 0;
      lines.forEach((l) => {
        drawRow(["", l.material_name, l.bag_count, l.pack_size, l.actual_tons.toFixed(3), ""]);
        totalBags += Number(l.bag_count || 0);
        totalActual += l.actual_tons;
      });

      doc.moveTo(startX, y - 2).lineTo(startX + tableWidth, y - 2).stroke();
      doc.font("Helvetica-Bold");
      drawRow(["", "TOTAL", totalBags, "", totalActual.toFixed(3), ""]);
      doc.font("Helvetica");

      doc.moveDown(2);
      doc.fontSize(8).fillColor("#666").text(
        "Note: \"Shift\" and \"Approx in Tank\" are not tracked by this system and are left blank for manual entry.",
        { width: tableWidth }
      );

      doc.end();
    } catch (err) {
      next(err);
    }
  },
};