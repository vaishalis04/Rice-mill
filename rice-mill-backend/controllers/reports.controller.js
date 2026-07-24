const { Op } = require("sequelize");
const {
  GateEntry, Vehicle, Driver, Vendor, MaterialMaster, PlantMaster,
  ProductionBatch, Lot, LengthGrading,
} = require("../models/index");

// Day-wise, shift-wise, MIS, cycle/process-time reports (Module 23)
// Both endpoints below return plain paginated JSON — the FE renders them as
// Ant Design Tables and offers CSV export client-side.

module.exports = {
  // GET /api/reports/gate-register?from=&to=&page=&limit=
  gateRegister: async (req, res, next) => {
    try {
      const { from, to, plant_id, page = 1, limit = 50 } = req.query;

      const where = { is_deleted: false };
      if (plant_id) where.plant_id = plant_id;
      if (from || to) {
        where.entry_time = {};
        if (from) where.entry_time[Op.gte] = new Date(from);
        if (to) where.entry_time[Op.lte] = new Date(`${to}T23:59:59.999Z`);
      }

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await GateEntry.findAndCountAll({
        where,
        include: [
          { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no", "type"] },
          { model: Driver, as: "driver", attributes: ["id", "name", "mobile"] },
          { model: Vendor, as: "vendor", attributes: ["id", "vendor_code", "name"] },
          { model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name"] },
          { model: PlantMaster, as: "plant", attributes: ["id", "plant_code", "name"] },
        ],
        order: [["entry_time", "DESC"]],
        limit: Number(limit),
        offset,
        distinct: true,
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

  // GET /api/reports/production-summary?from=&to=&page=&limit=
  productionSummary: async (req, res, next) => {
    try {
      const { from, to, plant_id, page = 1, limit = 50 } = req.query;

      const where = { is_deleted: false };
      if (plant_id) where.plant_id = plant_id;
      if (from || to) {
        where.production_date = {};
        if (from) where.production_date[Op.gte] = from;
        if (to) where.production_date[Op.lte] = to;
      }

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await ProductionBatch.findAndCountAll({
        where,
        include: [
          { model: Lot, as: "lot", attributes: ["id", "lot_no", "material_id"], include: [{ model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name"] }] },
          { model: LengthGrading, as: "lengthGrading" },
        ],
        order: [["production_date", "DESC"]],
        limit: Number(limit),
        offset,
        distinct: true,
      });

      const data = rows.map((batch) => {
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
      });

      res.status(200).json({
        success: true,
        data,
        pagination: { total: count, page: Number(page), limit: Number(limit), totalPages: Math.ceil(count / limit) },
      });
    } catch (err) {
      next(err);
    }
  },
};
