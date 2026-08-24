const { Op } = require("sequelize");
const {
  GateEntry, Vehicle, Driver, Vendor, MaterialMaster, PlantMaster,
  ProductionBatch, Lot, LengthGrading, Purchase, Inventory, FinishedGoods, Packing,
} = require("../models/index");
const { toCsv, sendCsv } = require("../helpers/csv");

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
};
