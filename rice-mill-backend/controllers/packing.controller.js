  const createError = require("http-errors");
  const { Op } = require("sequelize");
  const {
    Packing, FinishedGoods, ProductionBatch, Lot, User, WarehouseMaster, Inventory,MaterialMaster
  } = require("../models/index");
  const { generatePackingBatchNo, generateEAN13 } = require("../helpers/helperFunction");

  const DEFAULT_SHELF_LIFE_DAYS = 180;

  const detailIncludes = [
    { model: ProductionBatch, as: "batch", attributes: ["id", "batch_no", "warehouse_id"] },
    { model: User, as: "packer", attributes: ["id", "username", "email"] },
    {
      model: FinishedGoods,
      as: "finishedGoodsRecords",
      attributes: ["id", "warehouse_id", "qty", "fg_status"],
      include: [{ model: WarehouseMaster, as: "warehouse", attributes: ["id", "warehouse_code", "name"] }],
    },
  ];

  // Deducts `qty` tons of `material_id` from a warehouse's Inventory ledger
  // (oldest rows first) and drops the source Lot's qty by the same amount.
 const consumeFromWarehouse = async ({ warehouse_id, material_id, qty, lot_id, userId }) => {
  // Find inventory rows for this material in the warehouse
  const sourceRows = await Inventory.findAll({
    where: {
      warehouse_id,
      material_id,
      is_deleted: false,
      balance_qty: { [Op.gt]: 0 },
      // Remove stage filter to catch all inventory records
      // stage: { [Op.in]: ["raw", "fg"] },
    },
    order: [["as_of", "ASC"]],
  });

  if (sourceRows.length === 0) {
    throw createError(400, `No inventory found for material ${material_id} in warehouse ${warehouse_id}`);
  }

  let remaining = Number(qty);
  let totalAvailable = sourceRows.reduce((sum, row) => sum + Number(row.balance_qty || 0), 0);
  
  if (remaining > totalAvailable + 0.001) {
    throw createError(400, `Not enough stock for material ${material_id}. Available: ${totalAvailable.toFixed(3)}, Required: ${remaining.toFixed(3)}`);
  }

  for (const row of sourceRows) {
    if (remaining <= 0.001) break;
    const available = Number(row.balance_qty || 0);
    const toConsume = Math.min(available, remaining);
    if (toConsume <= 0.001) continue;
    
    row.balance_qty = Number(row.balance_qty) - toConsume;
    row.qty_out = Number(row.qty_out || 0) + toConsume;
    row.as_of = new Date();
    row.updated_by = userId;
    await row.save();
    remaining -= toConsume;
  }

  // If we still have remaining quantity after processing all rows, something went wrong
  if (remaining > 0.001) {
    throw createError(400, `Could not deduct full quantity for material ${material_id}. Remaining: ${remaining.toFixed(3)}`);
  }

  // Update the lot quantity if lot_id is provided
  if (lot_id) {
    const lot = await Lot.findOne({ where: { id: lot_id, is_deleted: false } });
    if (lot) {
      const newQty = Math.max(0, Number(lot.qty || 0) - Number(qty));
      await lot.update({ 
        qty: newQty, 
        updated_by: userId 
      });
    }
  }
};

  const createPackingRecord = async ({
    batch, materialId, lotId, packSize, bagCount, qtyOverride,
    destinationWarehouseId, rackId, palletId, productionDate, shelfLifeDays, plantId, userId,
  }) => {
    const warehouse = await WarehouseMaster.findOne({ where: { id: destinationWarehouseId, is_deleted: false } });
    if (!warehouse) throw createError(400, "Invalid destination warehouse_id");

    const calculatedQty = packSize * bagCount;
    const qtyInKg = qtyOverride != null && qtyOverride !== "" ? Number(qtyOverride) : calculatedQty;
    const qtyInTons = qtyInKg / 1000;

    const resolvedProductionDate = productionDate || new Date().toISOString().slice(0, 10);
    const shelfDays = shelfLifeDays !== undefined ? Number(shelfLifeDays) : DEFAULT_SHELF_LIFE_DAYS;
    const expiry = new Date(resolvedProductionDate);
    expiry.setDate(expiry.getDate() + shelfDays);

    const batchNo = await generatePackingBatchNo();
    const barcode = await generateEAN13();
    const qr_code = JSON.stringify({ batch_no: batchNo, production_batch_no: batch.batch_no, production_date: resolvedProductionDate });
    const resolvedPlantId = plantId || batch.plant_id;

    const packing = await Packing.create({
      batch_id: batch.id,
      lot_id: lotId,
      material_id: materialId,
      pack_size: packSize,
      bag_count: bagCount,
      batch_no: batchNo,
      barcode,
      qr_code,
      production_date: resolvedProductionDate,
      expiry_date: expiry.toISOString().slice(0, 10),
      packed_by: userId,
      plant_id: resolvedPlantId,
      created_by: userId,
    });

    const finishedGoods = await FinishedGoods.create({
      packing_id: packing.id,
      warehouse_id: destinationWarehouseId,
      rack_id: rackId,
      pallet_id: palletId,
      qty: qtyInKg,
      fg_status: "ready",
      ready_since: new Date(),
      plant_id: resolvedPlantId,
      created_by: userId,
    });

    await Inventory.create({
      lot_id: lotId, // <-- was missing; Inventory.lot_id is NOT NULL
      material_id: materialId,
      warehouse_id: destinationWarehouseId,
      stage: "fg",
      qty_in: qtyInTons,
      qty_out: 0,
      balance_qty: qtyInTons,
      as_of: new Date(),
      plant_id: resolvedPlantId,
      created_by: userId,
    });

    return { packing, finishedGoods, qty_in_kg: qtyInKg, qty_in_tons: qtyInTons };
  };

  module.exports = {
    getAll: async (req, res, next) => {
      try {
        const { batch_id, plant_id, page = 1, limit = 20 } = req.query;
        const where = { is_deleted: false };
        if (batch_id) where.batch_id = batch_id;
        if (plant_id) where.plant_id = plant_id;

        const offset = (Number(page) - 1) * Number(limit);
        const { rows, count } = await Packing.findAndCountAll({
          where, include: detailIncludes, order: [["created_at", "DESC"]],
          limit: Number(limit), offset, distinct: true,
        });

        res.status(200).json({
          success: true, data: rows,
          pagination: { total: count, page: Number(page), limit: Number(limit), totalPages: Math.ceil(count / limit) },
        });
      } catch (err) { next(err); }
    },

    getById: async (req, res, next) => {
      try {
        const packing = await Packing.findOne({ where: { id: req.params.id, is_deleted: false }, include: detailIncludes });
        if (!packing) throw createError(404, "Packing record not found");
        res.status(200).json({ success: true, data: packing });
      } catch (err) { next(err); }
    },

  completeAndPack: async (req, res, next) => {
    try {
      const {
        batch_id, destination_warehouse_id, materials,
        rack_id, pallet_id, production_date, shelf_life_days, plant_id,
      } = req.body;

      if (!batch_id) throw createError(400, "batch_id is required");
      if (!destination_warehouse_id) throw createError(400, "destination_warehouse_id is required");
      if (!Array.isArray(materials) || materials.length === 0) {
        throw createError(400, "materials (with pack_size and bag_count) is required");
      }

      const batch = await ProductionBatch.findOne({
        where: { id: batch_id, is_deleted: false }
      });
      if (!batch) throw createError(400, "Invalid batch_id");
      if (batch.batch_status === "completed") throw createError(400, "This batch is already completed");
      if (!batch.materials_data || batch.materials_data.length === 0) {
        throw createError(400, "This batch has no reserved materials to pack");
      }

      // Map of reserved INPUT materials (e.g. paddy) -> { input_qty, lot_id }
      const reservedMaterialsMap = {};
      batch.materials_data.forEach((reserved) => {
        reservedMaterialsMap[Number(reserved.material_id)] = {
          ...reserved,
          input_qty: Number(reserved.input_qty),
        };
      });
      const fallbackReserved = batch.materials_data[0];

      // Validate output items — material_id here is whatever OUTPUT
      // material is being packed, and is NOT required to match a
      // reserved input material.
      for (const item of materials) {
        const materialId = Number(item.material_id);
        if (!materialId) throw createError(400, "Each material must have a material_id");
        if (!(Number(item.pack_size) > 0)) {
          throw createError(400, `pack_size for material ${materialId} must be a positive number`);
        }
        if (!(Number(item.bag_count) > 0)) {
          throw createError(400, `bag_count for material ${materialId} must be greater than 0`);
        }
        if (item.source_material_id && !reservedMaterialsMap[Number(item.source_material_id)]) {
          throw createError(400, `source_material_id ${item.source_material_id} was not reserved in this batch`);
        }
      }

      // 1) Deduct the RESERVED INPUT quantity from the source warehouse —
      // once per reserved material, regardless of what gets packed as output.
      for (const reserved of batch.materials_data) {
        await consumeFromWarehouse({
          warehouse_id: batch.warehouse_id,
          material_id: Number(reserved.material_id),
          qty: Number(reserved.input_qty),
          lot_id: reserved.lot_id,
          userId: req.user ? req.user.id : null,
        });
      }

      // 2) Create packing records for each OUTPUT material
      const results = [];
      for (const item of materials) {
        const sourceReserved = item.source_material_id
          ? reservedMaterialsMap[Number(item.source_material_id)]
          : fallbackReserved;

        results.push(
          await createPackingRecord({
            batch,
            materialId: Number(item.material_id),
            lotId: sourceReserved.lot_id,
            packSize: Number(item.pack_size),
            bagCount: Number(item.bag_count),
            qtyOverride: item.qty_override,
            destinationWarehouseId: Number(destination_warehouse_id),
            rackId: rack_id,
            palletId: pallet_id,
            productionDate: production_date,
            shelfLifeDays: shelf_life_days,
            plantId: plant_id || batch.plant_id,
            userId: req.user ? req.user.id : null,
          })
        );
      }

      // 3) Batch is fully consumed/packed in one shot
      await batch.update({
        batch_status: "completed",
        current_stage: "completed",
        updated_by: req.user ? req.user.id : null,
      });

      const totalKg = results.reduce((sum, r) => sum + r.qty_in_kg, 0);
      const totalTons = totalKg / 1000;

      res.status(201).json({
        success: true,
        msg: `Batch ${batch.batch_no} completed. ${results.length} output material(s) packed — ${totalKg} kg (${totalTons.toFixed(3)} tons) added to destination warehouse.`,
        data: { results, total_qty_kg: totalKg, total_qty_tons: totalTons, batch_status: "completed" },
      });
    } catch (err) {
      next(err);
    }
  },

    update: async (req, res, next) => {
      try {
        const packing = await Packing.findOne({
          where: { id: req.params.id, is_deleted: false },
          include: [{ model: FinishedGoods, as: "finishedGoodsRecords", where: { is_deleted: false }, required: false }],
        });
        if (!packing) throw createError(404, "Packing record not found");

        const { pack_size, bag_count, production_date, expiry_date, plant_id } = req.body;
        if (pack_size !== undefined && !(Number(pack_size) > 0)) throw createError(400, "pack_size must be a positive number");
        if (bag_count !== undefined && Number(bag_count) <= 0) throw createError(400, "bag_count must be greater than 0");

        const changingQty = pack_size !== undefined || bag_count !== undefined;
        const dispatchedFg = (packing.finishedGoodsRecords || []).find((fg) => fg.fg_status === "dispatched" || fg.dispatch_id != null);
        if (changingQty && dispatchedFg) {
          throw createError(400, "Can't change pack size or bag count — this packing's finished goods stock has already been dispatched.");
        }

        const updates = { pack_size: pack_size !== undefined ? Number(pack_size) : undefined, bag_count, production_date, expiry_date, plant_id };
        Object.keys(updates).forEach((k) => updates[k] === undefined && delete updates[k]);
        updates.updated_by = req.user ? req.user.id : null;

        await packing.update(updates);

        if (changingQty) {
          const finalPackSize = Number(updates.pack_size ?? packing.pack_size);
          const finalBagCount = Number(updates.bag_count ?? packing.bag_count);
          await FinishedGoods.update(
            { qty: finalPackSize * finalBagCount, updated_by: req.user ? req.user.id : null },
            { where: { packing_id: packing.id, is_deleted: false } }
          );
        }

        const updated = await Packing.findByPk(packing.id, { include: detailIncludes });
        res.status(200).json({ success: true, msg: "Packing record updated", data: updated });
      } catch (err) {
        next(err);
      }
    },

    delete: async (req, res, next) => {
      try {
        const packing = await Packing.findOne({ where: { id: req.params.id, is_deleted: false } });
        if (!packing) throw createError(404, "Packing record not found");
        await packing.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
        res.status(200).json({ success: true, msg: "Packing record deleted" });
      } catch (err) {
        next(err);
      }
    },
  };