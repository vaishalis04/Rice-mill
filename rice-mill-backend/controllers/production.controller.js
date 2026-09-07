const createError = require("http-errors");
const { Op } = require("sequelize");
const { ProductionBatch, Lot, MaterialMaster, Inventory } = require("../models/index");
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

const getAvailableWarehouseStock = async ({ warehouse_id, material_id }) => {
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
  return Math.round(total * 1000) / 1000;
};

// Accepts either a single { material_id, input_qty } or a { materials: [...] } array.
const normalizeMaterials = (body) => {
  const { material_id, input_qty, materials } = body;
  if (Array.isArray(materials) && materials.length > 0) {
    return materials.map((m) => ({ material_id: Number(m.material_id), input_qty: Number(m.input_qty) }));
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

    for (const item of requested) {
      if (!item.material_id || !(item.input_qty > 0)) {
        throw createError(400, "Each material must have a valid material_id and input_qty greater than 0");
      }

      // Check if we have enough inventory
      const availableQty = await getAvailableWarehouseStock({ 
        warehouse_id: Number(warehouse_id), 
        material_id: item.material_id 
      });
      
      const roundedAvailable = Math.round(availableQty * 1000) / 1000;
      const requestedQty = Math.round(item.input_qty * 1000) / 1000;
      const tolerance = 0.001;
      
      if (roundedAvailable > 0 && requestedQty > roundedAvailable + tolerance) {
        const material = await MaterialMaster.findByPk(item.material_id);
        throw createError(400, `${material?.name || item.material_id}: requested ${requestedQty.toFixed(3)} tons exceeds available stock (${roundedAvailable.toFixed(3)} tons)`);
      }

      // Find a lot with this material in the warehouse
      const lot = await Lot.findOne({
        where: {
          warehouse_id: Number(warehouse_id),
          material_id: item.material_id,
          is_deleted: false,
          unloading_status: "completed",
          qty: { [Op.gt]: 0.001 },
        },
        order: [["created_at", "DESC"]],
      });

      if (!lot) {
        const material = await MaterialMaster.findByPk(item.material_id);
        throw createError(404, `No completed stock found for material ${material?.name || item.material_id} in the selected warehouse`);
      }

      materialsData.push({
        material_id: item.material_id,
        input_qty: requestedQty,
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