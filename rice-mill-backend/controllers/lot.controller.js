const createError = require("http-errors");
const {
  Lot, Purchase, GateEntry, MaterialMaster, VarietyMaster, PurchaseOrder,
  Stack, WarehouseMaster, BinStackMaster, Inventory, User,
} = require("../models/index");
const { generateLotNo } = require("../helpers/helperFunction");

// Unloading & Lot creation, traceability backbone (Module 9 / part 2)
// A lot is opened once a gate entry has been weighed (gate_status = 'in_process').
// Creating a lot also opens its initial Stack placement and writes the opening
// Inventory balance. Routing the lot (warehouse vs production) is a separate step
// that finalizes the gate entry's journey to 'unloaded'.

const lotIncludes = [
  { model: Purchase, as: "purchase", attributes: ["id", "gate_entry_id", "final_qty", "final_rate"] },
  { model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name"] },
  { model: VarietyMaster, as: "variety", attributes: ["id", "variety_name"] },
  { model: Lot, as: "parentLot", attributes: ["id", "lot_no"] },
];

module.exports = {
  // GET /api/lots?material_id=&destination=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { material_id, destination, plant_id, page = 1, limit = 20 } = req.query;

      const where = { is_deleted: false };
      if (material_id) where.material_id = material_id;
      if (destination) where.destination = destination;
      if (plant_id) where.plant_id = plant_id;

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await Lot.findAndCountAll({
        where,
        include: lotIncludes,
        order: [["created_at", "DESC"]],
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

  // GET /api/lots/:id  (includes its stack placements)
  getById: async (req, res, next) => {
    try {
      const lot = await Lot.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: [
          ...lotIncludes,
          {
            model: Stack,
            as: "stacks",
            attributes: ["id", "stack_code", "warehouse_id", "bin_id", "qty", "stacked_at"],
            include: [{ model: WarehouseMaster, as: "warehouse", attributes: ["id", "warehouse_code", "name"] }],
          },
        ],
      });
      if (!lot) throw createError(404, "Lot not found");
      res.status(200).json({ success: true, data: lot });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/lots
  // { gate_entry_id, warehouse_id, bin_id, qty?, material_id?, variety_id?, parent_lot_id?, stacked_at? }
  create: async (req, res, next) => {
    try {
      const {
        gate_entry_id, warehouse_id, bin_id, qty, material_id, variety_id,
        parent_lot_id, stacked_at, plant_id,
      } = req.body;
      if (!gate_entry_id || !warehouse_id || !bin_id) {
        throw createError(400, "gate_entry_id, warehouse_id and bin_id are required");
      }

      const gateEntry = await GateEntry.findOne({ where: { id: gate_entry_id, is_deleted: false } });
      if (!gateEntry) throw createError(400, "Invalid gate_entry_id");
      if (gateEntry.gate_status !== "in_process") {
        throw createError(400, `Cannot create a lot for a gate entry with status '${gateEntry.gate_status}'; it must be 'in_process' (weighed)`);
      }

      const purchase = await Purchase.findOne({ where: { gate_entry_id, is_deleted: false } });
      if (!purchase) throw createError(400, "No finalized purchase found for this gate entry; complete the weighbridge step first");

      const warehouse = await WarehouseMaster.findOne({ where: { id: warehouse_id, is_deleted: false } });
      if (!warehouse) throw createError(400, "Invalid warehouse_id");

      const bin = await BinStackMaster.findOne({ where: { id: bin_id, is_deleted: false } });
      if (!bin) throw createError(400, "Invalid bin_id");
      if (Number(bin.warehouse_id) !== Number(warehouse_id)) {
        throw createError(400, "bin_id does not belong to the given warehouse_id");
      }

      const resolvedMaterialId = material_id || gateEntry.material_id;
      const materialRecord = await MaterialMaster.findOne({ where: { id: resolvedMaterialId, is_deleted: false } });
      if (!materialRecord) throw createError(400, "Invalid material_id");

      let resolvedVarietyId = variety_id || null;
      if (!resolvedVarietyId && gateEntry.po_id) {
        const po = await PurchaseOrder.findOne({ where: { id: gateEntry.po_id, is_deleted: false } });
        resolvedVarietyId = po ? po.variety_id : null;
      }
      if (resolvedVarietyId) {
        const variety = await VarietyMaster.findOne({ where: { id: resolvedVarietyId, is_deleted: false } });
        if (!variety) throw createError(400, "Invalid variety_id");
      }

      if (parent_lot_id) {
        const parentLot = await Lot.findOne({ where: { id: parent_lot_id, is_deleted: false } });
        if (!parentLot) throw createError(400, "Invalid parent_lot_id");
      }

      const resolvedQty = qty !== undefined ? Number(qty) : Number(purchase.final_qty);
      if (!(resolvedQty > 0)) throw createError(400, "qty must be greater than 0");

      const lot_no = await generateLotNo();

      const lot = await Lot.create({
        lot_no,
        purchase_id: purchase.id,
        material_id: resolvedMaterialId,
        variety_id: resolvedVarietyId,
        qty: resolvedQty,
        parent_lot_id: parent_lot_id || null,
        plant_id: plant_id || gateEntry.plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      const stack = await Stack.create({
        stack_code: `${lot_no}-S1`,
        lot_id: lot.id,
        warehouse_id,
        bin_id,
        qty: resolvedQty,
        stacked_at: stacked_at || new Date(),
        plant_id: lot.plant_id,
        created_by: req.user ? req.user.id : null,
      });

      // Inventory service: opening raw-material balance for this lot.
      const inventory = await Inventory.create({
        lot_id: lot.id,
        material_id: resolvedMaterialId,
        warehouse_id,
        stage: "raw",
        qty_in: resolvedQty,
        qty_out: 0,
        balance_qty: resolvedQty,
        as_of: new Date(),
        plant_id: lot.plant_id,
        created_by: req.user ? req.user.id : null,
      });

      const created = await Lot.findByPk(lot.id, { include: lotIncludes });
      res.status(201).json({
        success: true,
        msg: `Lot ${lot_no} created`,
        data: { lot: created, stack, inventory },
      });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/lots/:id
  update: async (req, res, next) => {
    try {
      const lot = await Lot.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!lot) throw createError(404, "Lot not found");

      const { qty, material_id, variety_id, parent_lot_id, plant_id } = req.body;

      if (material_id) {
        const material = await MaterialMaster.findOne({ where: { id: material_id, is_deleted: false } });
        if (!material) throw createError(400, "Invalid material_id");
      }
      if (variety_id) {
        const variety = await VarietyMaster.findOne({ where: { id: variety_id, is_deleted: false } });
        if (!variety) throw createError(400, "Invalid variety_id");
      }
      if (parent_lot_id) {
        const parentLot = await Lot.findOne({ where: { id: parent_lot_id, is_deleted: false } });
        if (!parentLot) throw createError(400, "Invalid parent_lot_id");
        if (Number(parent_lot_id) === Number(lot.id)) throw createError(400, "A lot cannot be its own parent");
      }

      const updates = { qty, material_id, variety_id, parent_lot_id, plant_id };
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      updates.updated_by = req.user ? req.user.id : null;

      await lot.update(updates);

      const updated = await Lot.findByPk(lot.id, { include: lotIncludes });
      res.status(200).json({ success: true, msg: "Lot updated", data: updated });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/lots/:id/route  { destination: "warehouse" | "production" }
  // Records where the lot is headed and, if it originated from a gate entry,
  // advances that gate entry's status to 'unloaded'.
  route: async (req, res, next) => {
    try {
      const { destination } = req.body;
      if (!["warehouse", "production"].includes(destination)) {
        throw createError(400, "destination must be 'warehouse' or 'production'");
      }

      const lot = await Lot.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!lot) throw createError(404, "Lot not found");

      await lot.update({ destination, updated_by: req.user ? req.user.id : null });

      let gateEntry = null;
      if (lot.purchase_id) {
        const purchase = await Purchase.findOne({ where: { id: lot.purchase_id, is_deleted: false } });
        if (purchase) {
          gateEntry = await GateEntry.findOne({ where: { id: purchase.gate_entry_id, is_deleted: false } });
          if (gateEntry) {
            await gateEntry.update({ gate_status: "unloaded", updated_by: req.user ? req.user.id : null });
          }
        }
      }

      const updated = await Lot.findByPk(lot.id, { include: lotIncludes });
      res.status(200).json({
        success: true,
        msg: `Lot routed to ${destination}${gateEntry ? " — gate entry status is now 'unloaded'" : ""}`,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/lots/:id  (soft delete)
  delete: async (req, res, next) => {
    try {
      const lot = await Lot.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!lot) throw createError(404, "Lot not found");

      await lot.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Lot deleted" });
    } catch (err) {
      next(err);
    }
  },
};
