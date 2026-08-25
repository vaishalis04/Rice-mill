const createError = require("http-errors");
const {
  Lot, Purchase, GateEntry, MaterialMaster, VarietyMaster, PurchaseOrder, Sampling, LabTest,
  Stack, WarehouseMaster, BinStackMaster, Inventory, User,WeightSlip
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
  {
    model: Purchase,
    as: "purchase",
    attributes: ["id", "gate_entry_id", "final_qty", "final_rate"],
    include: [{
      model: GateEntry,
      as: "gateEntry",
      attributes: ["id", "token_no"],
      include: [{
        model: Sampling,
        as: "samplings",
        attributes: ["id", "sample_code"],
        include: [{ model: LabTest, as: "labTest", attributes: ["id", "comment"] }],
      }],
    }],
  },
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
      gate_entry_id, warehouse_id, bin_id, parent_lot_id, plant_id,
    } = req.body;
    
    if (!gate_entry_id || !warehouse_id) {
      throw createError(400, "gate_entry_id and warehouse_id are required");
    }

    // 1. Get the gate entry
    const gateEntry = await GateEntry.findOne({ 
      where: { id: gate_entry_id, is_deleted: false } 
    });
    if (!gateEntry) throw createError(400, "Invalid gate_entry_id");
    
    if (gateEntry.gate_status !== "in_process") {
      throw createError(400, `Cannot start unloading for a gate entry with status '${gateEntry.gate_status}'; it must be 'in_process' (weighed)`);
    }

    // 2. Get or create WeightSlip
    let weightSlip = await WeightSlip.findOne({ 
      where: { gate_entry_id, is_deleted: false } 
    });
    
    if (!weightSlip) {
      throw createError(400, "No weight slip found for this gate entry. Please complete weighbridge first.");
    }

    // 3. Get or create Purchase
    let purchase = await Purchase.findOne({ 
      where: { gate_entry_id, is_deleted: false } 
    });
    
    if (!purchase) {
      // Create purchase from weight slip data
      const netQty = weightSlip.tare_weight != null ? 
        Number(weightSlip.gross_weight) - Number(weightSlip.tare_weight) : 0;
      
      // Get PO rate if available
      let resolvedRate = 0;
      if (gateEntry.po_id) {
        const po = await PurchaseOrder.findOne({ 
          where: { id: gateEntry.po_id, is_deleted: false } 
        });
        if (po) resolvedRate = Number(po.rate);
      } else {
        // Try to get rate from purchase_orders junction
        try {
          const GateEntryPurchaseOrder = require('../models').GateEntryPurchaseOrder;
          const poItems = await GateEntryPurchaseOrder.findAll({
            where: { gate_entry_id: gateEntry.id, is_deleted: false },
            include: ['purchaseOrder']
          });
          if (poItems && poItems.length > 0) {
            const firstPO = poItems[0].purchaseOrder;
            if (firstPO) resolvedRate = Number(firstPO.rate);
          }
        } catch (err) {
          console.warn('Could not get rate from junction table:', err.message);
        }
      }

      purchase = await Purchase.create({
        po_id: gateEntry.po_id || null,
        gate_entry_id,
        weight_slip_id: weightSlip.id,
        final_rate: resolvedRate,
        final_qty: netQty,
        amount: netQty * resolvedRate,
        purchase_date: new Date().toISOString().slice(0, 10),
        plant_id: gateEntry.plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });
    }

    // 4. Check if lots already exist
    const existingLots = await Lot.findAll({ 
      where: { purchase_id: purchase.id, is_deleted: false } 
    });
    if (existingLots && existingLots.length > 0) {
      throw createError(409, `Lots already exist for this gate entry's purchase`);
    }

    // 5. Get materials from gate entry
    let materials = [];
    
    // Try to get materials from purchase_orders junction table
    try {
      const GateEntryPurchaseOrder = require('../models').GateEntryPurchaseOrder;
      const poItems = await GateEntryPurchaseOrder.findAll({
        where: { gate_entry_id: gateEntry.id, is_deleted: false },
        include: [
          { model: MaterialMaster, as: 'material' },
          { model: PurchaseOrder, as: 'purchaseOrder' }
        ]
      });
      
      if (poItems && poItems.length > 0) {
        // Get unique material IDs
        const materialMap = new Map();
        poItems.forEach(item => {
          if (item.material_id && !materialMap.has(item.material_id)) {
            materialMap.set(item.material_id, {
              material_id: item.material_id,
              material: item.material,
              po_id: item.po_id,
              purchaseOrder: item.purchaseOrder
            });
          }
        });
        materials = Array.from(materialMap.values());
      }
    } catch (err) {
      console.warn('Could not get materials from junction table:', err.message);
    }

    // If no materials from junction table, try to get from gate entry
    if (materials.length === 0 && gateEntry.material_id) {
      const material = await MaterialMaster.findOne({ 
        where: { id: gateEntry.material_id, is_deleted: false } 
      });
      if (material) {
        materials.push({
          material_id: material.id,
          material: material,
          po_id: gateEntry.po_id,
          purchaseOrder: gateEntry.po_id ? await PurchaseOrder.findOne({ 
            where: { id: gateEntry.po_id, is_deleted: false } 
          }) : null
        });
      }
    }

    if (materials.length === 0) {
      throw createError(400, "No materials found for this gate entry. Please add materials to the gate entry first.");
    }

    // 6. Validate warehouse
    const warehouse = await WarehouseMaster.findOne({ 
      where: { id: warehouse_id, is_deleted: false } 
    });
    if (!warehouse) throw createError(400, "Invalid warehouse_id");

    if (bin_id) {
      const bin = await BinStackMaster.findOne({ 
        where: { id: bin_id, is_deleted: false } 
      });
      if (!bin) throw createError(400, "Invalid bin_id");
      if (Number(bin.warehouse_id) !== Number(warehouse_id)) {
        throw createError(400, "bin_id does not belong to the given warehouse_id");
      }
    }

    // 7. Create lots for each material
    const resolvedPlantId = plant_id || gateEntry.plant_id || (req.user ? req.user.plant_id : null);
    const createdLots = [];
    
    for (const materialInfo of materials) {
      const lot_no = await generateLotNo();
      const lot = await Lot.create({
        lot_no,
        purchase_id: purchase.id,
        material_id: materialInfo.material_id,
        variety_id: null,
        qty: 0,
        parent_lot_id: parent_lot_id || null,
        warehouse_id,
        bin_id: bin_id || null,
        unloading_status: "in_progress",
        plant_id: resolvedPlantId,
        created_by: req.user ? req.user.id : null,
      });
      createdLots.push(lot);
    }

    // 8. Update gate entry status
    await gateEntry.update({ 
      gate_status: "unloading", 
      updated_by: req.user ? req.user.id : null 
    });

    // 9. Return response
    res.status(201).json({
      success: true,
      msg: `Unloading started — ${createdLots.length} lot(s) opened. Complete each lot with bag counts.`,
      data: { 
        lots: createdLots,
        purchase: purchase,
        materials: materials.map(m => ({
          id: m.material_id,
          name: m.material ? m.material.name : 'Unknown',
          po_id: m.po_id
        }))
      },
    });
  } catch (err) {
    console.error('Start unloading error:', err);
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
    const { items } = req.body; // Array of { lot_id, bag_size, accepted_bags, rejected_bags }
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw createError(400, "Please provide at least one material/lot to complete unloading");
    }

    const completedLots = [];
    const stacks = [];
    const inventories = [];

    for (const item of items) {
      const { lot_id, bag_size, accepted_bags, rejected_bags = 0 } = item;

      const lot = await Lot.findOne({ where: { id: lot_id, is_deleted: false } });
      if (!lot) throw createError(404, `Lot ${lot_id} not found`);
      if (lot.unloading_status === "completed") {
        throw createError(409, `Lot ${lot.lot_no} has already been completed`);
      }

      const bagSizeNum = Number(bag_size);
      const acceptedBagsNum = Number(accepted_bags);
      const rejectedBagsNum = Number(rejected_bags);

      if (!(bagSizeNum > 0)) throw createError(400, "bag_size must be greater than 0");
      if (!Number.isInteger(acceptedBagsNum) || acceptedBagsNum < 0) {
        throw createError(400, "accepted_bags must be a whole number, 0 or more");
      }
      if (!Number.isInteger(rejectedBagsNum) || rejectedBagsNum < 0) {
        throw createError(400, "rejected_bags must be a whole number, 0 or more");
      }
      if (acceptedBagsNum + rejectedBagsNum <= 0) {
        throw createError(400, "At least one bag (accepted or rejected) is required");
      }

      const acceptedQty = Math.round(bagSizeNum * acceptedBagsNum * 100) / 100;
      const rejectedQty = Math.round(bagSizeNum * rejectedBagsNum * 100) / 100;

      await lot.update({
        qty: acceptedQty,
        bag_size: bagSizeNum,
        accepted_bags: acceptedBagsNum,
        rejected_bags: rejectedBagsNum,
        rejected_qty: rejectedQty,
        unloading_status: "completed",
        updated_by: req.user ? req.user.id : null,
      });

      completedLots.push(lot);

      // Create stack and inventory for accepted quantity
      if (acceptedQty > 0) {
        const stack = await Stack.create({
          stack_code: `${lot.lot_no}-S1`,
          lot_id: lot.id,
          warehouse_id: lot.warehouse_id,
          bin_id: lot.bin_id,
          qty: acceptedQty,
          stacked_at: new Date(),
          plant_id: lot.plant_id,
          created_by: req.user ? req.user.id : null,
        });
        stacks.push(stack);

        const inventory = await Inventory.create({
          lot_id: lot.id,
          material_id: lot.material_id,
          warehouse_id: lot.warehouse_id,
          stage: "raw",
          qty_in: acceptedQty,
          qty_out: 0,
          balance_qty: acceptedQty,
          as_of: new Date(),
          plant_id: lot.plant_id,
          created_by: req.user ? req.user.id : null,
        });
        inventories.push(inventory);
      }
    }

    // Update gate entry status to unloaded
    const firstLot = completedLots[0];
    if (firstLot && firstLot.purchase_id) {
      const purchase = await Purchase.findOne({ where: { id: firstLot.purchase_id, is_deleted: false } });
      if (purchase) {
        const gateEntry = await GateEntry.findOne({ where: { id: purchase.gate_entry_id, is_deleted: false } });
        if (gateEntry) {
          await gateEntry.update({ gate_status: "unloaded", updated_by: req.user ? req.user.id : null });
        }
      }
    }

    res.status(200).json({
      success: true,
      msg: `Unloading completed for ${completedLots.length} material(s)`,
      data: { 
        lots: completedLots, 
        stacks, 
        inventories,
        summary: completedLots.map(lot => ({
          lot_no: lot.lot_no,
          material: lot.material?.name || lot.material_id,
          accepted_bags: lot.accepted_bags,
          accepted_qty: lot.qty,
          rejected_bags: lot.rejected_bags,
          rejected_qty: lot.rejected_qty
        }))
      },
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