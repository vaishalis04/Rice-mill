const createError = require("http-errors");
const {
  Lot, Purchase, GateEntry, MaterialMaster, VarietyMaster, PurchaseOrder,
  Stack, WarehouseMaster, BinStackMaster, Inventory, User,
} = require("../models/index");
const { generateLotNo } = require("../helpers/helperFunction");

// Unloading & Lot creation, traceability backbone (Module 9 / part 2)
//
// Unloading is now a two-step workflow instead of one "record and done" action:
//   1. Start Unloading (startUnloading) — gate entry must be 'in_process' (weighed).
//      Opens a Lot shell (qty = 0, unloading_status = 'in_progress') and moves the
//      gate entry to 'unloading'. This is the point where the truck is opened up and
//      a manual check happens at the factory — no stock exists yet.
//   2. Complete Unloading (completeUnloading) — once the manual check is done, the
//      operator enters bag_size + accepted_bags + rejected_bags. Accepted/rejected
//      quantities are auto-calculated (bag_size * bags). Only the ACCEPTED qty opens
//      the Stack placement and the opening Inventory balance; rejected qty is recorded
//      on the lot for traceability but never enters stock. The gate entry then moves
//      to 'unloaded'.
// Routing the lot (warehouse vs production) remains a separate step after that —
// it decides whether the now-known accepted stock stays as raw warehouse stock or
// goes straight into a production batch.

const lotIncludes = [
  { model: Purchase, as: "purchase", attributes: ["id", "gate_entry_id", "final_qty", "final_rate"] },
  { model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name"] },
  { model: VarietyMaster, as: "variety", attributes: ["id", "variety_name"] },
  { model: Lot, as: "parentLot", attributes: ["id", "lot_no"] },
  { model: WarehouseMaster, as: "targetWarehouse", attributes: ["id", "warehouse_code", "name"] },
  { model: BinStackMaster, as: "targetBin", attributes: ["id", "bin_code"] },
  {
    model: Stack,
    as: "stacks",
    attributes: ["id", "warehouse_id", "bin_id", "qty"],
    include: [
      { model: WarehouseMaster, as: "warehouse", attributes: ["id", "warehouse_code", "name"] },
      { model: BinStackMaster, as: "bin", attributes: ["id", "bin_code"] },
    ],
  },
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

  // POST /api/lots/start-unloading
  // { gate_entry_id, warehouse_id, bin_id, material_id?, variety_id?, parent_lot_id?, plant_id? }
  // Step 1 of unloading: truck is opened up at the factory for a manual check.
  // Opens a Lot shell (qty = 0, unloading_status = 'in_progress') — no Stack or
  // Inventory yet, since the accepted quantity isn't known until bags are counted.
  startUnloading: async (req, res, next) => {
    try {
      const {
        gate_entry_id, warehouse_id, bin_id, material_id, variety_id,
        parent_lot_id, plant_id,
      } = req.body;
      if (!gate_entry_id || !warehouse_id || !bin_id) {
        throw createError(400, "gate_entry_id, warehouse_id and bin_id are required");
      }

      const gateEntry = await GateEntry.findOne({ where: { id: gate_entry_id, is_deleted: false } });
      if (!gateEntry) throw createError(400, "Invalid gate_entry_id");
      if (gateEntry.gate_status !== "in_process") {
        throw createError(400, `Cannot start unloading for a gate entry with status '${gateEntry.gate_status}'; it must be 'in_process' (weighed)`);
      }

      let purchase = await Purchase.findOne({ where: { gate_entry_id, is_deleted: false } });
      if (!purchase) {
        // Try to create a placeholder Purchase from an existing weight slip so
        // the operator can Start Unloading immediately after first weighment.
        // This uses the linked PO's rate if available, otherwise falls back to 0.
        const weightSlip = await require('../models/index').WeightSlip.findOne({ where: { gate_entry_id, is_deleted: false } });
        if (!weightSlip) throw createError(400, "No finalized purchase found for this gate entry; complete the weighbridge step first");

        // Resolve rate from PO if available
        let resolvedRate = null;
        if (gateEntry.po_id) {
          const po = await PurchaseOrder.findOne({ where: { id: gateEntry.po_id, is_deleted: false } });
          if (po) resolvedRate = Number(po.rate);
        }

        // If we can't resolve a rate, use 0 as placeholder so lot creation may proceed.
        const placeholderRate = resolvedRate != null ? resolvedRate : 0;
        const netQty = weightSlip.tare_weight != null ? Number(weightSlip.gross_weight) - Number(weightSlip.tare_weight) : 0;

        purchase = await Purchase.create({
          po_id: gateEntry.po_id || null,
          gate_entry_id,
          weight_slip_id: weightSlip.id,
          final_rate: placeholderRate,
          final_qty: netQty,
          amount: netQty * placeholderRate,
          purchase_date: new Date().toISOString().slice(0, 10),
          plant_id: gateEntry.plant_id || (req.user ? req.user.plant_id : null),
          created_by: req.user ? req.user.id : null,
        });
      }

      const existingLot = await Lot.findOne({ where: { purchase_id: purchase.id, is_deleted: false } });
      if (existingLot) throw createError(409, `A lot (${existingLot.lot_no}) already exists for this gate entry's purchase`);

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

      const lot_no = await generateLotNo();
      const resolvedPlantId = plant_id || gateEntry.plant_id || (req.user ? req.user.plant_id : null);

      const lot = await Lot.create({
        lot_no,
        purchase_id: purchase.id,
        material_id: resolvedMaterialId,
        variety_id: resolvedVarietyId,
        qty: 0,
        parent_lot_id: parent_lot_id || null,
        warehouse_id,
        bin_id,
        unloading_status: "in_progress",
        plant_id: resolvedPlantId,
        created_by: req.user ? req.user.id : null,
      });

      await gateEntry.update({ gate_status: "unloading", updated_by: req.user ? req.user.id : null });

      const created = await Lot.findByPk(lot.id, { include: lotIncludes });
      res.status(201).json({
        success: true,
        msg: `Unloading started — Lot ${lot_no} opened. Do the manual check at the factory, then complete unloading with bag counts.`,
        data: { lot: created },
      });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/lots/:id/complete-unloading
  // { bag_size, accepted_bags, rejected_bags? }
  // Step 2 of unloading: bags have been counted after the manual check.
  // accepted_qty = bag_size * accepted_bags, rejected_qty = bag_size * rejected_bags.
  // Only the accepted qty opens the Stack placement + opening Inventory balance.
  completeUnloading: async (req, res, next) => {
    try {
      const lot = await Lot.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!lot) throw createError(404, "Lot not found");
      if (lot.unloading_status === "completed") {
        throw createError(409, "Unloading has already been completed for this lot");
      }

      const bag_size = Number(req.body.bag_size);
      const accepted_bags = Number(req.body.accepted_bags);
      const rejected_bags = req.body.rejected_bags !== undefined ? Number(req.body.rejected_bags) : 0;

      if (!(bag_size > 0)) throw createError(400, "bag_size must be greater than 0");
      if (!Number.isInteger(accepted_bags) || accepted_bags < 0) {
        throw createError(400, "accepted_bags must be a whole number, 0 or more");
      }
      if (!Number.isInteger(rejected_bags) || rejected_bags < 0) {
        throw createError(400, "rejected_bags must be a whole number, 0 or more");
      }
      if (accepted_bags + rejected_bags <= 0) {
        throw createError(400, "At least one bag (accepted or rejected) is required");
      }

      const accepted_qty = Math.round(bag_size * accepted_bags * 100) / 100;
      const rejected_qty = Math.round(bag_size * rejected_bags * 100) / 100;

      await lot.update({
        qty: accepted_qty,
        bag_size,
        accepted_bags,
        rejected_bags,
        rejected_qty,
        unloading_status: "completed",
        updated_by: req.user ? req.user.id : null,
      });

      let stack = null;
      let inventory = null;

      // Accepted bags only — rejected material never enters Stack/Inventory,
      // it's kept purely on the lot record for traceability.
      if (accepted_qty > 0) {
        stack = await Stack.create({
          stack_code: `${lot.lot_no}-S1`,
          lot_id: lot.id,
          warehouse_id: lot.warehouse_id,
          bin_id: lot.bin_id,
          qty: accepted_qty,
          stacked_at: new Date(),
          plant_id: lot.plant_id,
          created_by: req.user ? req.user.id : null,
        });

        inventory = await Inventory.create({
          lot_id: lot.id,
          material_id: lot.material_id,
          warehouse_id: lot.warehouse_id,
          stage: "raw",
          qty_in: accepted_qty,
          qty_out: 0,
          balance_qty: accepted_qty,
          as_of: new Date(),
          plant_id: lot.plant_id,
          created_by: req.user ? req.user.id : null,
        });
      }

      // Truck is now physically empty and its contents counted — close out the gate journey.
      if (lot.purchase_id) {
        const purchase = await Purchase.findOne({ where: { id: lot.purchase_id, is_deleted: false } });
        if (purchase) {
          const gateEntry = await GateEntry.findOne({ where: { id: purchase.gate_entry_id, is_deleted: false } });
          if (gateEntry) {
            await gateEntry.update({ gate_status: "unloaded", updated_by: req.user ? req.user.id : null });
          }
        }
      }

      const updated = await Lot.findByPk(lot.id, { include: lotIncludes });
      res.status(200).json({
        success: true,
        msg: `Unloading completed — ${accepted_bags} bag(s) accepted (${accepted_qty}), ${rejected_bags} bag(s) rejected (${rejected_qty}).${
          accepted_qty > 0 ? " Route the accepted stock to Warehouse or Production below." : ""
        }`,
        data: { lot: updated, stack, inventory, accepted_qty, rejected_qty },
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
  // Decides where the ACCEPTED stock goes next — stays as raw warehouse stock, or
  // heads straight into a production batch. The gate entry itself already moved to
  // 'unloaded' when unloading was completed (bags counted); routing is purely about
  // the stock's next stage, so it only needs unloading to have finished.
  route: async (req, res, next) => {
    try {
      const { destination } = req.body;
      if (!["warehouse", "production"].includes(destination)) {
        throw createError(400, "destination must be 'warehouse' or 'production'");
      }

      const lot = await Lot.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!lot) throw createError(404, "Lot not found");
      if (lot.unloading_status !== "completed") {
        throw createError(400, "Cannot route a lot before unloading is completed (bag counts recorded)");
      }

      await lot.update({ destination, updated_by: req.user ? req.user.id : null });

      const updated = await Lot.findByPk(lot.id, { include: lotIncludes });
      res.status(200).json({
        success: true,
        msg: `Lot routed to ${destination}`,
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