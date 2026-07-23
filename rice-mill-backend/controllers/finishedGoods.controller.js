const createError = require("http-errors");
const { Op } = require("sequelize");
const { FinishedGoods, Packing, WarehouseMaster, ProductionBatch } = require("../models/index");

// FG stock, rack/pallet, aging (Module 17)
// aged_days is a virtual field (today - ready_since) computed live on every read,
// so it's always current without any batch job. The nightly node-cron job (see
// jobs/agingJob.js) only needs to flip fg_status 'ready' -> 'aging' once a row
// crosses the 30-day threshold; flagAging below is the same logic, callable
// on demand (e.g. for testing without waiting for the cron to fire).

const AGING_THRESHOLD_DAYS = 30;

const detailIncludes = [
  {
    model: Packing,
    as: "packing",
    attributes: ["id", "batch_no", "pack_size", "bag_count", "barcode", "qr_code", "production_date", "expiry_date", "batch_id"],
    include: [{ model: ProductionBatch, as: "batch", attributes: ["id", "batch_no"] }],
  },
  { model: WarehouseMaster, as: "warehouse", attributes: ["id", "warehouse_code", "name"] },
];

module.exports = {
  // GET /api/finished-goods?status=&pack_size=&warehouse_id=&from=&to=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { status, pack_size, warehouse_id, from, to, plant_id, page = 1, limit = 20 } = req.query;

      const where = { is_deleted: false };
      if (status) where.fg_status = status;
      if (warehouse_id) where.warehouse_id = warehouse_id;
      if (plant_id) where.plant_id = plant_id;

      const packingWhere = { is_deleted: false };
      if (pack_size) packingWhere.pack_size = pack_size;
      if (from || to) {
        packingWhere.production_date = {};
        if (from) packingWhere.production_date[Op.gte] = from;
        if (to) packingWhere.production_date[Op.lte] = to;
      }

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await FinishedGoods.findAndCountAll({
        where,
        include: [
          {
            model: Packing,
            as: "packing",
            attributes: ["id", "batch_no", "pack_size", "bag_count", "barcode", "qr_code", "production_date", "expiry_date", "batch_id"],
            where: packingWhere,
            required: true,
            include: [{ model: ProductionBatch, as: "batch", attributes: ["id", "batch_no"] }],
          },
          { model: WarehouseMaster, as: "warehouse", attributes: ["id", "warehouse_code", "name"] },
        ],
        order: [["ready_since", "DESC"]],
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

  // GET /api/finished-goods/:id
  getById: async (req, res, next) => {
    try {
      const record = await FinishedGoods.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: detailIncludes,
      });
      if (!record) throw createError(404, "Finished goods record not found");
      res.status(200).json({ success: true, data: record });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/finished-goods  (manual creation — normally auto-created by POST /api/packing)
  create: async (req, res, next) => {
    try {
      const { packing_id, warehouse_id, rack_id, pallet_id, qty, fg_status, plant_id } = req.body;

      if (!packing_id || !warehouse_id || qty === undefined) {
        throw createError(400, "packing_id, warehouse_id and qty are required");
      }
      if (fg_status && !["ready", "on_hold", "aging", "dispatched"].includes(fg_status)) {
        throw createError(400, "Invalid fg_status");
      }

      const packing = await Packing.findOne({ where: { id: packing_id, is_deleted: false } });
      if (!packing) throw createError(400, "Invalid packing_id");

      const warehouse = await WarehouseMaster.findOne({ where: { id: warehouse_id, is_deleted: false } });
      if (!warehouse) throw createError(400, "Invalid warehouse_id");

      const record = await FinishedGoods.create({
        packing_id,
        warehouse_id,
        rack_id,
        pallet_id,
        qty,
        fg_status: fg_status || "ready",
        ready_since: new Date(),
        plant_id: plant_id || packing.plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      res.status(201).json({ success: true, msg: "Finished goods record created", data: record });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/finished-goods/:id
  update: async (req, res, next) => {
    try {
      const record = await FinishedGoods.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!record) throw createError(404, "Finished goods record not found");

      const { warehouse_id, rack_id, pallet_id, qty, fg_status, plant_id } = req.body;
      if (fg_status && !["ready", "on_hold", "aging", "dispatched"].includes(fg_status)) {
        throw createError(400, "Invalid fg_status");
      }
      if (warehouse_id) {
        const warehouse = await WarehouseMaster.findOne({ where: { id: warehouse_id, is_deleted: false } });
        if (!warehouse) throw createError(400, "Invalid warehouse_id");
      }

      const updates = { warehouse_id, rack_id, pallet_id, qty, fg_status, plant_id };
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      updates.updated_by = req.user ? req.user.id : null;

      // Resetting to 'ready' (e.g. after resolving an on_hold) restarts the aging clock.
      if (fg_status === "ready" && record.fg_status !== "ready") updates.ready_since = new Date();

      await record.update(updates);

      const updated = await FinishedGoods.findByPk(record.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Finished goods record updated", data: updated });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/finished-goods/:id  (soft delete)
  delete: async (req, res, next) => {
    try {
      const record = await FinishedGoods.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!record) throw createError(404, "Finished goods record not found");

      await record.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Finished goods record deleted" });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/finished-goods/flag-aging
  // Manually runs the same "flag stock >30 days as aging" sweep the nightly
  // cron job performs — handy for testing without waiting for midnight.
  flagAging: async (req, res, next) => {
    try {
      const cutoff = new Date(Date.now() - AGING_THRESHOLD_DAYS * 86400000);

      const candidates = await FinishedGoods.findAll({
        where: { is_deleted: false, fg_status: "ready", ready_since: { [Op.lte]: cutoff } },
      });

      await Promise.all(candidates.map((row) => row.update({ fg_status: "aging" })));

      res.status(200).json({
        success: true,
        msg: `${candidates.length} finished-goods record(s) flagged as 'aging'`,
        data: candidates.map((c) => c.id),
      });
    } catch (err) {
      next(err);
    }
  },
};
