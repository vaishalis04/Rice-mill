const createError = require("http-errors");
const { Op } = require("sequelize");
const { ProductionBatch, Lot, MaterialMaster, Inventory, Packing } = require("../models/index");
const { generateBatchNo } = require("../helpers/helperFunction");

// Simplified production flow (Module 11):
// 1. Pick a warehouse -> see what materials/qty are available in it.
// 2. Pick one or more materials + qty -> creates a ProductionBatch.
//    Nothing is deducted from stock yet; the batch just "reserves" the
//    materials it intends to consume.
// 3. The packing step (packing.controller.js -> completeAndPack) is called
//    right after. That single step deducts the reserved qty from the
//    source warehouse and adds the packed output to whatever warehouse
//    was picked as the destination, then marks the batch completed.
//
// There is no dryer / milling / separator / shiner / color-sorter /
// length-grading pipeline any more.

const detailIncludes = [
  { model: Lot, as: "lot", attributes: ["id", "lot_no", "material_id", "qty", "warehouse_id", "destination", "bin_id"] },
];

// Materials on a ProductionBatch, normalized to [{material_id, input_qty}, ...]
// regardless of whether it's the new multi-material shape (materials_data)
// or a legacy single-material batch (bare material_id / input_qty columns).
const getBatchMaterialLines = (batch) => {
  if (Array.isArray(batch.materials_data) && batch.materials_data.length > 0) {
    return batch.materials_data.map((m) => ({ ...m, material_id: Number(m.material_id), input_qty: Number(m.input_qty) }));
  }
  if (batch.material_id) {
    return [{ material_id: Number(batch.material_id), input_qty: Number(batch.input_qty), lot_id: batch.lot_id, lot_no: null }];
  }
  return [];
};

// Raw inventory for a material in a warehouse, minus whatever is already
// reserved by OTHER pending (not-yet-packed) batches in that same
// warehouse. Pending batches don't touch Inventory yet, so without this
// subtraction two different batches could each reserve the same stock.
const getAvailableWarehouseStock = async ({ warehouse_id, material_id, excludeBatchId } = {}) => {
  if (!warehouse_id || !material_id) return 0;

  const rows = await Inventory.findAll({
    where: {
      is_deleted: false,
      warehouse_id,
      material_id,
      balance_qty: { [Op.gt]: 0 },
      stage: { [Op.in]: ["raw", "fg"] },
    },
  });
  const total = rows.reduce((sum, row) => sum + Number(row.balance_qty || 0), 0);

  const pendingWhere = { warehouse_id, batch_status: "pending", is_deleted: false };
  if (excludeBatchId) pendingWhere.id = { [Op.ne]: excludeBatchId };
  const pendingBatches = await ProductionBatch.findAll({
    where: pendingWhere,
    attributes: ["id", "material_id", "input_qty", "materials_data"],
  });

  let reserved = 0;
  for (const batch of pendingBatches) {
    for (const line of getBatchMaterialLines(batch)) {
      if (line.material_id === Number(material_id)) reserved += line.input_qty;
    }
  }

  const netAvailable = Math.max(total - reserved, 0);
  return Math.round(netAvailable * 1000) / 1000;
};

const getAvailableWarehouseBags = async ({ warehouse_id, material_id, pack_size, excludeBatchId } = {}) => {
  const rows = await Inventory.findAll({
    where: {
      is_deleted: false,
      warehouse_id,
      material_id,
      balance_qty: { [Op.gt]: 0 },
      stage: { [Op.in]: ["raw", "fg"] },
    },
    include: [{ model: Lot, as: "lot", attributes: ["id", "bag_size"] }],
  });
  const size = Number(pack_size);
  const fgLotIds = rows.filter((row) => row.stage === "fg").map((row) => row.lot_id).filter(Boolean);
  const fgPackings = fgLotIds.length
    ? await Packing.findAll({
        where: {
          lot_id: { [Op.in]: fgLotIds },
          is_deleted: false,
          [Op.or]: [{ material_id }, { material_id: null }],
        },
        attributes: ["lot_id", "material_id", "pack_size"],
      })
    : [];
  let available = rows.reduce((sum, row) => {
    const packing = fgPackings.find((candidate) => Number(candidate.lot_id) === Number(row.lot_id));
    const bagSize = row.stage === "fg" ? Number(packing?.pack_size) : Number(row.lot?.bag_size);
    return bagSize === size ? sum + Math.floor((Number(row.balance_qty || 0) * 1000) / size + 0.0001) : sum;
  }, 0);

  const pendingWhere = { warehouse_id, batch_status: "pending", is_deleted: false };
  if (excludeBatchId) pendingWhere.id = { [Op.ne]: excludeBatchId };
  const pendingBatches = await ProductionBatch.findAll({
    where: pendingWhere,
    attributes: ["material_id", "input_qty", "materials_data"],
  });
  for (const batch of pendingBatches) {
    for (const line of getBatchMaterialLines(batch)) {
      if (line.material_id === Number(material_id)) {
        available -= (Number(line.input_qty || 0) * 1000) / size;
      }
    }
  }
  return Math.max(Math.floor(available + 0.0001), 0);
};

// Accepts either a single { material_id, input_qty } or a { materials: [...] } array.
const normalizeMaterials = (body) => {
  const { material_id, input_qty, materials } = body;
  if (Array.isArray(materials) && materials.length > 0) {
    return materials.map((m) => {
      const packSize = Number(m.pack_size ?? m.pack_size_kg);
      const bagCount = Number(m.bag_count);
      return {
        material_id: Number(m.material_id),
        input_qty: m.input_qty !== undefined ? Number(m.input_qty) : (packSize * bagCount) / 1000,
        pack_size: packSize,
        bag_count: bagCount,
      };
    });
  }
  if (material_id && input_qty) {
    return [{ material_id: Number(material_id), input_qty: Number(input_qty) }];
  }
  return [];
};

module.exports = {
  // GET /api/production/batches?batch_status=&plant_id=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { batch_status, plant_id, page = 1, limit = 20 } = req.query;
      const where = { is_deleted: false };
      if (batch_status) where.batch_status = batch_status;
      if (plant_id) where.plant_id = plant_id;

      const offset = (Number(page) - 1) * Number(limit);
      const { rows, count } = await ProductionBatch.findAndCountAll({
        where,
        include: [{ model: Lot, as: "lot", attributes: ["id", "lot_no", "material_id"] }],
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

  getById: async (req, res, next) => {
    try {
      const batch = await ProductionBatch.findOne({ where: { id: req.params.id, is_deleted: false }, include: detailIncludes });
      if (!batch) throw createError(404, "Production batch not found");
      res.status(200).json({ success: true, data: batch });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/production/batches
  // { warehouse_id, materials: [{material_id, input_qty}], production_date?, plant_id? }
  // (also accepts a single material_id + input_qty instead of `materials`)
  create: async (req, res, next) => {
    try {
      const { warehouse_id, production_date, plant_id } = req.body;
      if (!warehouse_id) throw createError(400, "warehouse_id is required");

      const requested = normalizeMaterials(req.body);
      if (requested.length === 0) {
        throw createError(400, "Provide at least one material with a valid qty");
      }

      const materialsData = [];
      let totalInputQty = 0;
      const requestedBagsByStock = new Map();

      for (const item of requested) {
        if (!item.material_id || !(item.input_qty > 0)) {
          throw createError(400, "Each material must have a valid material_id and bag quantity greater than 0");
        }

        if (!(item.pack_size > 0) || !(item.bag_count > 0)) {
          throw createError(400, "Each production line must include a valid pack_size and bag_count");
        }

        const exactAvailableBags = await getAvailableWarehouseBags({
          warehouse_id: Number(warehouse_id),
          material_id: item.material_id,
          pack_size: item.pack_size,
        });
        const stockKey = `${item.material_id}:${item.pack_size}`;
        const cumulativeBags = (requestedBagsByStock.get(stockKey) || 0) + item.bag_count;
        requestedBagsByStock.set(stockKey, cumulativeBags);
        if (cumulativeBags > exactAvailableBags) {
          const material = await MaterialMaster.findByPk(item.material_id);
          throw createError(400, `${material?.name || item.material_id}: only ${exactAvailableBags} bags of ${item.pack_size}kg are available; requested ${cumulativeBags}`);
        }

        // Check if we have enough inventory (net of what other pending
        // batches have already reserved)
        const availableQty = await getAvailableWarehouseStock({
          warehouse_id: Number(warehouse_id),
          material_id: item.material_id,
        });

        const roundedAvailable = Math.round(availableQty * 1000) / 1000;
        const requestedQty = Math.round(item.input_qty * 1000) / 1000;
        const tolerance = 0.001;

        if (requestedQty > roundedAvailable + tolerance) {
          const material = await MaterialMaster.findByPk(item.material_id);
          throw createError(400, `${material?.name || item.material_id}: requested ${requestedQty.toFixed(3)} tons exceeds available stock (${roundedAvailable.toFixed(3)} tons)`);
        }

        const stockRows = await Inventory.findAll({
          where: {
            warehouse_id: Number(warehouse_id),
            material_id: item.material_id,
            is_deleted: false,
            balance_qty: { [Op.gt]: 0 },
            stage: { [Op.in]: ["raw", "fg"] },
          },
          order: [["as_of", "ASC"]],
        });
        const lot = stockRows[0]?.lot_id
          ? await Lot.findOne({ where: { id: stockRows[0].lot_id, is_deleted: false } })
          : null;

        if (!lot) {
          const material = await MaterialMaster.findByPk(item.material_id);
          throw createError(404, `No completed stock found for material ${material?.name || item.material_id} in the selected warehouse`);
        }

        materialsData.push({
          material_id: item.material_id,
          input_qty: requestedQty,
          pack_size: item.pack_size,
          bag_count: item.bag_count,
          lot_id: lot.id,
          lot_no: lot.lot_no,
        });
        totalInputQty += requestedQty;
      }

      const batch_no = await generateBatchNo();
      const batch = await ProductionBatch.create({
        batch_no,
        lot_id: materialsData.length === 1 ? materialsData[0].lot_id : null,
        material_id: materialsData.length === 1 ? materialsData[0].material_id : null,
        input_qty: totalInputQty,
        warehouse_id: Number(warehouse_id),
        production_date: production_date || new Date().toISOString().slice(0, 10),
        batch_status: "pending",
        current_stage: "packing",
        plant_id: plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
        is_multi_material: materialsData.length > 1,
        materials_data: materialsData,
      });

      res.status(201).json({
        success: true,
        msg: `Batch ${batch_no} created with ${materialsData.length} material(s) (${totalInputQty.toFixed(3)} tons total). Complete packing to finish this batch.`,
        data: { ...batch.toJSON(), materials: materialsData, total_input_qty: totalInputQty },
      });
    } catch (err) {
      next(err);
    }
  },

  update: async (req, res, next) => {
    try {
      const batch = await ProductionBatch.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!batch) throw createError(404, "Production batch not found");

      const { production_date, batch_status, plant_id } = req.body;
      const updates = { production_date, batch_status, plant_id };
      Object.keys(updates).forEach((k) => updates[k] === undefined && delete updates[k]);
      updates.updated_by = req.user ? req.user.id : null;

      await batch.update(updates);
      const updated = await ProductionBatch.findByPk(batch.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Batch updated", data: updated });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/production/batches/:id/materials
  // { material_id, input_qty }  — appends a material to a batch that hasn't
  // been packed yet. Only allowed while batch_status is still "pending".
  addMaterial: async (req, res, next) => {
    try {
      const batch = await ProductionBatch.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!batch) throw createError(404, "Production batch not found");

      if (batch.batch_status !== "pending") {
        throw createError(
          400,
          `Cannot add materials — this batch is already '${batch.batch_status}'. Materials can only be added before packing.`
        );
      }

      const { material_id, input_qty, pack_size, bag_count } = req.body;
      const resolvedPackSize = Number(pack_size);
      const resolvedBagCount = Number(bag_count);
      const resolvedInputQty = input_qty !== undefined
        ? Number(input_qty)
        : (resolvedPackSize * resolvedBagCount) / 1000;
      if (!material_id || !(resolvedPackSize > 0) || !(resolvedBagCount > 0) || !(resolvedInputQty > 0)) {
        throw createError(400, "material_id, pack_size, and bag_count are required");
      }

      const materialIdNum = Number(material_id);
      const requestedQty = Math.round(resolvedInputQty * 1000) / 1000;

      const existingMaterials = getBatchMaterialLines(batch);

      const exactAvailableBags = await getAvailableWarehouseBags({
        warehouse_id: batch.warehouse_id,
        material_id: materialIdNum,
        pack_size: resolvedPackSize,
        excludeBatchId: batch.id,
      });
      const existingBags = existingMaterials
        .filter((line) => Number(line.material_id) === materialIdNum && Number(line.pack_size) === resolvedPackSize)
        .reduce((sum, line) => sum + Number(line.bag_count || 0), 0);
      if (existingBags + resolvedBagCount > exactAvailableBags) {
        throw createError(400, `Only ${exactAvailableBags} bags of ${resolvedPackSize}kg are available for this material`);
      }

      const availableQty = await getAvailableWarehouseStock({
        warehouse_id: batch.warehouse_id,
        material_id: materialIdNum,
        excludeBatchId: batch.id,
      });
      const tolerance = 0.001;
      if (requestedQty > availableQty + tolerance) {
        const material = await MaterialMaster.findByPk(materialIdNum);
        throw createError(
          400,
          `${material?.name || materialIdNum}: requested ${requestedQty.toFixed(3)} tons exceeds available stock (${availableQty.toFixed(3)} tons)`
        );
      }

      const lot = await Lot.findOne({
        where: {
          warehouse_id: batch.warehouse_id,
          material_id: materialIdNum,
          is_deleted: false,
          unloading_status: "completed",
          qty: { [Op.gt]: 0.001 },
        },
        order: [["created_at", "DESC"]],
      });
      if (!lot) {
        const material = await MaterialMaster.findByPk(materialIdNum);
        throw createError(404, `No completed stock found for material ${material?.name || materialIdNum} in this batch's warehouse`);
      }

      existingMaterials.push({
        material_id: materialIdNum,
        input_qty: requestedQty,
        pack_size: resolvedPackSize,
        bag_count: resolvedBagCount,
        lot_id: lot.id,
        lot_no: lot.lot_no,
      });
      const newTotalQty = existingMaterials.reduce((sum, m) => sum + Number(m.input_qty), 0);

      await batch.update({
        materials_data: existingMaterials,
        is_multi_material: existingMaterials.length > 1,
        input_qty: newTotalQty,
        lot_id: existingMaterials.length === 1 ? existingMaterials[0].lot_id : null,
        material_id: existingMaterials.length === 1 ? existingMaterials[0].material_id : null,
        updated_by: req.user ? req.user.id : null,
      });

      const updated = await ProductionBatch.findByPk(batch.id, { include: detailIncludes });
      res.status(200).json({
        success: true,
        msg: `Material added. Batch total is now ${newTotalQty.toFixed(3)} tons.`,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/production/batches/:id/materials/:materialId
  // { input_qty } — changes the reserved qty of a material already on a
  // pending batch.
  updateMaterial: async (req, res, next) => {
    try {
      const batch = await ProductionBatch.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!batch) throw createError(404, "Production batch not found");

      if (batch.batch_status !== "pending") {
        throw createError(400, `Cannot modify materials — this batch is already '${batch.batch_status}'.`);
      }

      const materialIdNum = Number(req.params.materialId);
      const { input_qty } = req.body;
      if (!(Number(input_qty) > 0)) throw createError(400, "input_qty must be greater than 0");
      const requestedQty = Math.round(Number(input_qty) * 1000) / 1000;

      const existingMaterials = getBatchMaterialLines(batch);
      const idx = existingMaterials.findIndex((m) => m.material_id === materialIdNum);
      if (idx === -1) throw createError(404, "This material is not part of the batch");

      // Available stock, excluding this batch's own current reservations
      // entirely (both this material's existing qty and its other
      // materials on this batch don't count against this check).
      const availableExcludingSelf = await getAvailableWarehouseStock({
        warehouse_id: batch.warehouse_id,
        material_id: materialIdNum,
        excludeBatchId: batch.id,
      });
      const tolerance = 0.001;
      if (availableExcludingSelf > 0 && requestedQty > availableExcludingSelf + tolerance) {
        const material = await MaterialMaster.findByPk(materialIdNum);
        throw createError(
          400,
          `${material?.name || materialIdNum}: requested ${requestedQty.toFixed(3)} tons exceeds available stock (${availableExcludingSelf.toFixed(3)} tons)`
        );
      }

      existingMaterials[idx] = { ...existingMaterials[idx], input_qty: requestedQty };
      const newTotalQty = existingMaterials.reduce((sum, m) => sum + Number(m.input_qty), 0);

      await batch.update({
        materials_data: existingMaterials,
        input_qty: newTotalQty,
        updated_by: req.user ? req.user.id : null,
      });

      const updated = await ProductionBatch.findByPk(batch.id, { include: detailIncludes });
      res.status(200).json({
        success: true,
        msg: `Quantity updated. Batch total is now ${newTotalQty.toFixed(3)} tons.`,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/production/batches/:id/materials/:materialId/swap
  // { new_material_id } — changes which material a reserved line refers
  // to, keeping the same reserved qty. Only allowed while batch_status is
  // "pending".
  swapMaterial: async (req, res, next) => {
    try {
      const batch = await ProductionBatch.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!batch) throw createError(404, "Production batch not found");

      if (batch.batch_status !== "pending") {
        throw createError(400, `Cannot modify materials — this batch is already '${batch.batch_status}'.`);
      }

      const oldMaterialId = Number(req.params.materialId);
      const { new_material_id } = req.body;
      if (!new_material_id) throw createError(400, "new_material_id is required");
      const newMaterialId = Number(new_material_id);
      if (newMaterialId === oldMaterialId) {
        throw createError(400, "That's already the material on this line");
      }

      const existingMaterials = getBatchMaterialLines(batch);
      const idx = existingMaterials.findIndex((m) => m.material_id === oldMaterialId);
      if (idx === -1) throw createError(404, "This material is not part of the batch");

      if (existingMaterials.some((m) => m.material_id === newMaterialId)) {
        throw createError(400, "That material is already on this batch as a separate line");
      }

      const qty = existingMaterials[idx].input_qty;

      const availableQty = await getAvailableWarehouseStock({
        warehouse_id: batch.warehouse_id,
        material_id: newMaterialId,
        excludeBatchId: batch.id,
      });
      const tolerance = 0.001;
      if (availableQty > 0 && qty > availableQty + tolerance) {
        const material = await MaterialMaster.findByPk(newMaterialId);
        throw createError(
          400,
          `${material?.name || newMaterialId}: this line needs ${qty.toFixed(3)} tons but only ${availableQty.toFixed(3)} tons available`
        );
      }

      const lot = await Lot.findOne({
        where: {
          warehouse_id: batch.warehouse_id,
          material_id: newMaterialId,
          is_deleted: false,
          unloading_status: "completed",
          qty: { [Op.gt]: 0.001 },
        },
        order: [["created_at", "DESC"]],
      });
      if (!lot) {
        const material = await MaterialMaster.findByPk(newMaterialId);
        throw createError(404, `No completed stock found for material ${material?.name || newMaterialId} in this batch's warehouse`);
      }

      existingMaterials[idx] = { material_id: newMaterialId, input_qty: qty, lot_id: lot.id, lot_no: lot.lot_no };

      await batch.update({
        materials_data: existingMaterials,
        lot_id: existingMaterials.length === 1 ? existingMaterials[0].lot_id : null,
        material_id: existingMaterials.length === 1 ? existingMaterials[0].material_id : null,
        updated_by: req.user ? req.user.id : null,
      });

      const updated = await ProductionBatch.findByPk(batch.id, { include: detailIncludes });
      res.status(200).json({
        success: true,
        msg: "Material changed on this line.",
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/production/batches/:id/materials/:materialId
  // Removes a material from a pending batch (a batch must keep at least
  // one material — delete the whole batch instead if none are needed).
  removeMaterial: async (req, res, next) => {
    try {
      const batch = await ProductionBatch.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!batch) throw createError(404, "Production batch not found");

      if (batch.batch_status !== "pending") {
        throw createError(400, `Cannot modify materials — this batch is already '${batch.batch_status}'.`);
      }

      const materialIdNum = Number(req.params.materialId);
      const existingMaterials = getBatchMaterialLines(batch);
      const idx = existingMaterials.findIndex((m) => m.material_id === materialIdNum);
      if (idx === -1) throw createError(404, "This material is not part of the batch");
      if (existingMaterials.length === 1) {
        throw createError(400, "Can't remove the only material on a batch. Delete the batch instead if it's no longer needed.");
      }

      existingMaterials.splice(idx, 1);
      const newTotalQty = existingMaterials.reduce((sum, m) => sum + Number(m.input_qty), 0);

      await batch.update({
        materials_data: existingMaterials,
        is_multi_material: existingMaterials.length > 1,
        input_qty: newTotalQty,
        lot_id: existingMaterials.length === 1 ? existingMaterials[0].lot_id : null,
        material_id: existingMaterials.length === 1 ? existingMaterials[0].material_id : null,
        updated_by: req.user ? req.user.id : null,
      });

      const updated = await ProductionBatch.findByPk(batch.id, { include: detailIncludes });
      res.status(200).json({
        success: true,
        msg: `Material removed. Batch total is now ${newTotalQty.toFixed(3)} tons.`,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },

  delete: async (req, res, next) => {
    try {
      const batch = await ProductionBatch.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!batch) throw createError(404, "Production batch not found");
      await batch.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Production batch deleted" });
    } catch (err) {
      next(err);
    }
  },
};