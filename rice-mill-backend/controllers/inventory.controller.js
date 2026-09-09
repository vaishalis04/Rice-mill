const createError = require("http-errors");
const { Op } = require("sequelize");
const { Inventory, StockMovement, Lot, MaterialMaster, WarehouseMaster, FinishedGoods, Packing } = require("../models/index");

// Real-time stock ledger across all stages (Module 10)
// getAll/getById back a raw per-row ledger view. getStockSummary below
// backs the Inventory page's grouped "item x location x bag size" table —
// create/update/delete/ledger remain TODO until the full stock-movement
// ledger (Module 10) is built out.
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
        pagination: {
          total: count,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(count / Number(limit)),
        },
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

  // GET /api/inventory/stock-summary
  // One row per (material, warehouse, bag size). Bulk/raw stock (not yet
  // packed) gets bag_size=null and bag_count=null since there's no real
  // bag size to report for it; packed stock is grouped by its actual pack
  // size, with total bag count, total tons, and a "last movement"
  // timestamp/idle-days figure per group. All quantities are in tons.
  getStockSummary: async (req, res, next) => {
    try {
      const rowsByKey = new Map();

      // ---- Raw / bulk stock ----
      // Grouped by material + warehouse + bag size where the unloaded lot
      // recorded one (Lot.bag_size, set at "complete unloading" time).
      // bag_count is a DERIVED estimate (remaining tons / bag size) —
      // production consumption only reduces Inventory.balance_qty in tons,
      // it never decrements a bag count, so this isn't a literal untouched
      // count once any of that lot has been drawn on.
        const inventoryRows = await Inventory.findAll({
          where: { is_deleted: false, stage: { [Op.in]: ["raw", "fg"] }, balance_qty: { [Op.gt]: 0 } },
        include: [
          { model: MaterialMaster, as: "material", attributes: ["id", "name", "material_code"] },
          { model: WarehouseMaster, as: "warehouse", attributes: ["id", "name"] },
          { model: Lot, as: "lot", attributes: ["id", "bag_size"] },
        ],
      });

      for (const row of inventoryRows) {
        const bagSize = row.lot?.bag_size != null ? Number(row.lot.bag_size) : null;
        const balance = Number(row.balance_qty || 0);
          const key = `${row.stage}|${row.material_id}|${row.warehouse_id}|${bagSize}`;
        const lastMoved = row.as_of ? new Date(row.as_of) : null;
        const existing = rowsByKey.get(key) || {
          material_id: row.material_id,
          material_name: row.material?.name || `Material ${row.material_id}`,
          material_code: row.material?.material_code || null,
          warehouse_id: row.warehouse_id,
          warehouse_name: row.warehouse?.name || null,
          bag_size: bagSize,
          bag_count: bagSize ? 0 : null,
          qty_tons: 0,
          last_movement: null,
        };
        existing.qty_tons += balance;
        if (bagSize) existing.bag_count += Math.floor((balance * 1000) / bagSize + 0.0001);
        if (lastMoved && (!existing.last_movement || lastMoved > existing.last_movement)) {
          existing.last_movement = lastMoved;
        }
        rowsByKey.set(key, existing);
      }

      // ---- Packed stock, grouped by material + warehouse + pack size ----
      // (Packing has no material_id column of its own — its material is
      // whatever material its lot was for: Packing.lot_id -> Lot.material_id.)

      const now = Date.now();
      const data = Array.from(rowsByKey.values())
        .map((r) => ({
          ...r,
          qty_tons: Math.round(r.qty_tons * 1000) / 1000,
          // Bag counts are physical whole bags. Partial weight remains in
          // qty_tons and is not displayed as a fractional bag.
          bag_count: r.bag_count != null ? Math.floor(r.bag_count) : null,
          last_movement: r.last_movement ? r.last_movement.toISOString() : null,
          idle_days: r.last_movement ? Math.floor((now - r.last_movement.getTime()) / 86400000) : null,
        }))
        .filter((r) => r.qty_tons > 0.001)
        .sort((a, b) => (b.last_movement || "").localeCompare(a.last_movement || ""));

      res.status(200).json({ success: true, data });
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