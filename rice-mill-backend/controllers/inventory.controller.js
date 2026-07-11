const createError = require("http-errors");
const { Inventory, StockMovement, Lot, MaterialMaster, WarehouseMaster } = require("../models/index");

// Real-time stock ledger across all stages (Module 10)
// Only getAll/getById are implemented here for now — they back the Warehouse page's
// "current stock" table. Inventory rows themselves are written automatically by
// Lot creation (see lot.controller.js); create/update/delete/ledger remain TODO
// until the full stock-movement ledger (Module 10) is built out.
const detailIncludes = [
  { model: Lot, as: "lot", attributes: ["id", "lot_no", "qty"] },
  { model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name"] },
  { model: WarehouseMaster, as: "warehouse", attributes: ["id", "warehouse_code", "name"] },
];

module.exports = {
  // GET /api/inventory?warehouse_id=&material_id=&stage=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { warehouse_id, material_id, stage, plant_id, page = 1, limit = 20 } = req.query;

      const where = { is_deleted: false };
      if (warehouse_id) where.warehouse_id = warehouse_id;
      if (material_id) where.material_id = material_id;
      if (stage) where.stage = stage;
      if (plant_id) where.plant_id = plant_id;

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await Inventory.findAndCountAll({
        where,
        include: detailIncludes,
        order: [["as_of", "DESC"]],
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

  getById: async (req, res, next) => {
    try {
      const record = await Inventory.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: detailIncludes,
      });
      if (!record) throw createError(404, "Inventory record not found");
      res.status(200).json({ success: true, data: record });
    } catch (err) {
      next(err);
    }
  },

  create: async (req, res, next) => {
    try {
      // TODO: create inventory from req.body
      res.status(201).json({ success: true, msg: "Created", data: null });
    } catch (err) {
      next(err);
    }
  },

  update: async (req, res, next) => {
    try {
      // TODO: update inventory req.params.id with req.body
      res.status(200).json({ success: true, msg: "Updated", data: null });
    } catch (err) {
      next(err);
    }
  },

  delete: async (req, res, next) => {
    try {
      // TODO: soft-delete inventory req.params.id (is_deleted = true)
      res.status(200).json({ success: true, msg: "Deleted" });
    } catch (err) {
      next(err);
    }
  },

  ledger: async (req, res, next) => {
    try {
      // TODO: implement ledger (Module 10 — full StockMovement-based audit trail)
      res.status(200).json({ success: true, msg: "ledger not yet implemented" });
    } catch (err) {
      next(err);
    }
  },
};
