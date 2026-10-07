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
  // size, with total bag count, total Qtl, and a "last movement"
  // timestamp/idle-days figure per group. All quantities are in Qtl.
  getStockSummary: async (req, res, next) => {
    try {
      const rowsByKey = new Map();
      const addRow = ({ stage, materialId, materialName, materialCode, warehouseId, warehouseName, bagSize, qty, movedAt }) => {
        const key = `${stage}|${materialId}|${warehouseId}|${bagSize}`;
        const existing = rowsByKey.get(key) || {
          stage,
          material_id: materialId,
          material_name: materialName || `Material ${materialId}`,
          material_code: materialCode || null,
          warehouse_id: warehouseId,
          warehouse_name: warehouseName || null,
          bag_size: bagSize,
          bag_count: bagSize ? 0 : null,
          qty_Qtl: 0,
          last_movement: null,
        };
        const balance = Number(qty || 0);
        existing.qty_Qtl += balance;
        if (bagSize) existing.bag_count += Math.floor((balance * 1000) / bagSize + 0.0001);
        const moved = movedAt ? new Date(movedAt) : null;
        if (moved && (!existing.last_movement || moved > existing.last_movement)) existing.last_movement = moved;
        rowsByKey.set(key, existing);
      };

      // Raw stock comes from the Inventory ledger. Packed stock comes from
      // live FinishedGoods, the same physical source used by Warehouse/Stock;
      // legacy Inventory(fg) rows are not counted as an additional balance.
      const inventoryRows = await Inventory.findAll({
        where: { is_deleted: false, stage: "raw", balance_qty: { [Op.gt]: 0 } },
        include: [
          { model: MaterialMaster, as: "material", attributes: ["id", "name", "material_code"] },
          { model: WarehouseMaster, as: "warehouse", attributes: ["id", "name"] },
          { model: Lot, as: "lot", attributes: ["id", "bag_size"] },
        ],
      });

      for (const row of inventoryRows) {
        const bagSize = row.lot?.bag_size != null ? Number(row.lot.bag_size) : null;
        addRow({
          stage: "raw",
          materialId: Number(row.material_id),
          materialName: row.material?.name,
          materialCode: row.material?.material_code,
          warehouseId: row.warehouse_id,
          warehouseName: row.warehouse?.name,
          bagSize,
          qty: row.balance_qty,
          movedAt: row.as_of,
        });
      }

      const finishedGoods = await FinishedGoods.findAll({
        where: { is_deleted: false, fg_status: { [Op.ne]: "dispatched" }, qty: { [Op.gt]: 0 } },
        attributes: ["id", "packing_id", "warehouse_id", "qty", "ready_since", "updated_at"],
      });
      const packingIds = [...new Set(finishedGoods.map((row) => Number(row.packing_id)).filter(Boolean))];
      const packings = packingIds.length
        ? await Packing.findAll({ where: { id: { [Op.in]: packingIds }, is_deleted: false }, attributes: ["id", "lot_id", "material_id", "pack_size", "bag_count"] })
        : [];
      const packingById = new Map(packings.map((row) => [Number(row.id), row]));
      const lotIds = [...new Set(packings.map((row) => Number(row.lot_id)).filter(Boolean))];
      const lots = lotIds.length
        ? await Lot.findAll({ where: { id: { [Op.in]: lotIds } }, attributes: ["id", "material_id"] })
        : [];
      const materialIdByLot = new Map(lots.map((row) => [Number(row.id), Number(row.material_id)]));
      const materialIds = [...new Set(packings.map((row) => Number(row.material_id || materialIdByLot.get(Number(row.lot_id)))).filter(Boolean))];
      const [materials, warehouses] = await Promise.all([
        materialIds.length ? MaterialMaster.findAll({ where: { id: { [Op.in]: materialIds } }, attributes: ["id", "name", "material_code"] }) : [],
        WarehouseMaster.findAll({ attributes: ["id", "name"] }),
      ]);
      const materialById = new Map(materials.map((row) => [Number(row.id), row]));
      const warehouseById = new Map(warehouses.map((row) => [Number(row.id), row.name]));
      for (const row of finishedGoods) {
        const packing = packingById.get(Number(row.packing_id));
        if (!packing) continue;
        const materialId = Number(packing.material_id || materialIdByLot.get(Number(packing.lot_id)));
        if (!materialId) continue;
        const material = materialById.get(materialId);
        const bagSize = packing.pack_size != null ? Number(packing.pack_size) : null;
        const qtyQtl = Number(row.qty || 0) / 1000;
        addRow({
          stage: "fg",
          materialId,
          materialName: material?.name,
          materialCode: material?.material_code,
          warehouseId: row.warehouse_id,
          warehouseName: warehouseById.get(Number(row.warehouse_id)),
          bagSize,
          qty: qtyQtl,
          movedAt: row.ready_since || row.updated_at,
        });
      }

      const now = Date.now();
      const data = Array.from(rowsByKey.values())
        .map((r) => ({
          ...r,
          qty_Qtl: Math.round(r.qty_Qtl * 1000) / 1000,
          // Raw stock bag counts are derived estimates. Packed counts reflect
          // remaining weight so dispatched/partially consumed bags do not
          // remain counted as if all original bags were still present.
          bag_count: r.stage === "fg" && r.bag_size
            ? Math.floor((r.qty_Qtl * 1000) / r.bag_size + 0.0001)
            : r.bag_count != null ? Math.floor(r.bag_count) : null,
          last_movement: r.last_movement ? r.last_movement.toISOString() : null,
          idle_days: r.last_movement ? Math.floor((now - r.last_movement.getTime()) / 86400000) : null,
        }))
        .filter((r) => r.qty_Qtl > 0.001)
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