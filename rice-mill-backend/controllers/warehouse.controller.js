const createError = require("http-errors");
const { Op } = require("sequelize");
const { WarehouseMaster, BinStackMaster, Stack, Lot, Inventory, MaterialMaster } = require("../models/index");
const { generateCode } = require("../helpers/helperFunction");

// Warehouse / Bin / Stack, raw material storage (Module 9)
// Fronts three related tables via `type` = "warehouse" | "bin" | "stack"
// (query param for GET/DELETE, body field for POST/PUT). Stack rows are
// normally created automatically by Lot creation (see lot.controller.js);
// this module also exposes direct CRUD for corrections.

const registry = {
  warehouse: { model: WarehouseMaster, label: "Warehouse" },
  bin: { model: BinStackMaster, label: "Bin" },
  stack: { model: Stack, label: "Stack" },
};

const getEntry = (type) => {
  const entry = registry[type];
  if (!entry) throw createError(400, `type must be one of: ${Object.keys(registry).join(", ")}`);
  return entry;
};

const getIncludes = (type) => {
  if (type === "bin") return [{ model: WarehouseMaster, as: "warehouse", attributes: ["id", "warehouse_code", "name"] }];
  if (type === "stack") {
    return [
      { model: Lot, as: "lot", attributes: ["id", "lot_no", "material_id"] },
      { model: WarehouseMaster, as: "warehouse", attributes: ["id", "warehouse_code", "name"] },
      { model: BinStackMaster, as: "bin", attributes: ["id", "bin_code"] },
    ];
  }
  return [];
};

const validateAndBuildPayload = async (type, body, { isUpdate = false, existing = null } = {}) => {
  if (type === "warehouse") {
    const { name, location, capacity, warehouse_type, plant_id } = body;
    const warehouse_code = isUpdate ? body.warehouse_code : await generateCode(WarehouseMaster, "warehouse_code", "WH");
    if (!isUpdate && (!name || !warehouse_type)) {
      throw createError(400, "name and warehouse_type are required");
    }
    if (warehouse_type && !["raw", "fg"].includes(warehouse_type)) {
      throw createError(400, "warehouse_type must be 'raw' or 'fg'");
    }
    if (warehouse_code) {
      const dup = await WarehouseMaster.findOne({ where: { warehouse_code, ...(existing ? { id: { [Op.ne]: existing.id } } : {}) } });
      if (dup) throw createError(409, "A warehouse with this warehouse_code already exists");
    }
    return { warehouse_code, name, location, capacity, type: warehouse_type, plant_id };
  }

  if (type === "bin") {
    const { warehouse_id, capacity, plant_id } = body;
    const bin_code = isUpdate ? body.bin_code : await generateCode(BinStackMaster, "bin_code", "BIN");
    if (!isUpdate && !warehouse_id) throw createError(400, "warehouse_id is required");
    if (warehouse_id) {
      const warehouse = await WarehouseMaster.findOne({ where: { id: warehouse_id, is_deleted: false } });
      if (!warehouse) throw createError(400, "Invalid warehouse_id");
    }
    if (bin_code) {
      const dup = await BinStackMaster.findOne({ where: { bin_code, ...(existing ? { id: { [Op.ne]: existing.id } } : {}) } });
      if (dup) throw createError(409, "A bin with this bin_code already exists");
    }
    return { bin_code, warehouse_id, capacity, plant_id };
  }

  // stack
  const { lot_id, warehouse_id, bin_id, qty, stacked_at, plant_id } = body;
  const stack_code = isUpdate ? body.stack_code : await generateCode(Stack, "stack_code", "STK");
  if (!isUpdate && (!lot_id || !warehouse_id || !bin_id || qty === undefined)) {
    throw createError(400, "lot_id, warehouse_id, bin_id and qty are required");
  }
  if (lot_id) {
    const lot = await Lot.findOne({ where: { id: lot_id, is_deleted: false } });
    if (!lot) throw createError(400, "Invalid lot_id");
  }
  if (warehouse_id) {
    const warehouse = await WarehouseMaster.findOne({ where: { id: warehouse_id, is_deleted: false } });
    if (!warehouse) throw createError(400, "Invalid warehouse_id");
  }
  if (bin_id) {
    const bin = await BinStackMaster.findOne({ where: { id: bin_id, is_deleted: false } });
    if (!bin) throw createError(400, "Invalid bin_id");
    if (warehouse_id && Number(bin.warehouse_id) !== Number(warehouse_id)) {
      throw createError(400, "bin_id does not belong to the given warehouse_id");
    }
  }
  if (stack_code) {
    const dup = await Stack.findOne({ where: { stack_code, ...(existing ? { id: { [Op.ne]: existing.id } } : {}) } });
    if (dup) throw createError(409, "A stack with this stack_code already exists");
  }
  return { stack_code, lot_id, warehouse_id, bin_id, qty, stacked_at, plant_id };
};

module.exports = {
  // GET /api/warehouse?type=warehouse|bin|stack&search=&plant_id=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { type, search, plant_id, page = 1, limit = 20 } = req.query;
      const { model: Model } = getEntry(type);

      const where = { is_deleted: false };
      if (plant_id) where.plant_id = plant_id;
      if (search) {
        const searchableFields = { warehouse: ["warehouse_code", "name"], bin: ["bin_code"], stack: ["stack_code"] }[type];
        if (searchableFields && searchableFields.length) {
          where[Op.or] = searchableFields.map((f) => ({ [f]: { [Op.like]: `%${search}%` } }));
        }
      }

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await Model.findAndCountAll({
        where,
        include: getIncludes(type),
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

  // GET /api/warehouse/:id/summary — capacity, current stock, remaining
  // space, and a material-wise breakdown for one warehouse. Used by the
  // Unloading page so picking a warehouse shows what's actually in it
  // before you commit a truck's load to it.
  getSummary: async (req, res, next) => {
    try {
      const warehouse = await WarehouseMaster.findOne({
        where: { id: req.params.id, is_deleted: false },
      });
      if (!warehouse) throw createError(404, "Warehouse not found");

      const inventoryRows = await Inventory.findAll({
        where: { warehouse_id: warehouse.id, is_deleted: false },
        include: [{ model: MaterialMaster, as: "material", attributes: ["id", "name", "material_code"] }],
      });

      const byMaterial = new Map();
      for (const row of inventoryRows) {
        const key = row.material_id;
        const existing = byMaterial.get(key) || {
          material_id: key,
          material_name: row.material?.name || `Material ${key}`,
          material_code: row.material?.material_code || null,
          qty: 0,
        };
        existing.qty += Number(row.balance_qty || 0);
        byMaterial.set(key, existing);
      }

      const materials = Array.from(byMaterial.values())
        .filter((m) => m.qty > 0)
        .sort((a, b) => b.qty - a.qty);

      const totalStock = materials.reduce((sum, m) => sum + m.qty, 0);
      const capacity = warehouse.capacity != null ? Number(warehouse.capacity) : null;
      const remainingCapacity = capacity != null ? Math.max(capacity - totalStock, 0) : null;

      res.status(200).json({
        success: true,
        data: {
          warehouse_id: warehouse.id,
          warehouse_code: warehouse.warehouse_code,
          name: warehouse.name,
          type: warehouse.type,
          capacity,
          total_stock: totalStock,
          remaining_capacity: remainingCapacity,
          materials,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/warehouse/:id?type=warehouse|bin|stack
  getById: async (req, res, next) => {
    try {
      const { type } = req.query;
      const { model: Model, label } = getEntry(type);

      const record = await Model.findOne({ where: { id: req.params.id, is_deleted: false }, include: getIncludes(type) });
      if (!record) throw createError(404, `${label} not found`);
      res.status(200).json({ success: true, data: record });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/warehouse  { type, ...fields }
  create: async (req, res, next) => {
    try {
      const { type } = req.body;
      const { model: Model, label } = getEntry(type);

      const payload = await validateAndBuildPayload(type, req.body);
      Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
      payload.created_by = req.user ? req.user.id : null;
      if ("plant_id" in payload) payload.plant_id = payload.plant_id || (req.user ? req.user.plant_id : null);

      const record = await Model.create(payload);
      const created = await Model.findByPk(record.id, { include: getIncludes(type) });

      res.status(201).json({ success: true, msg: `${label} created`, data: created });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/warehouse/:id  { type, ...fields }
  update: async (req, res, next) => {
    try {
      const { type } = req.body;
      const { model: Model, label } = getEntry(type);

      const record = await Model.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!record) throw createError(404, `${label} not found`);

      const payload = await validateAndBuildPayload(type, req.body, { isUpdate: true, existing: record });
      Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
      payload.updated_by = req.user ? req.user.id : null;

      await record.update(payload);
      const updated = await Model.findByPk(record.id, { include: getIncludes(type) });

      res.status(200).json({ success: true, msg: `${label} updated`, data: updated });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/warehouse/:id?type=warehouse|bin|stack  (soft delete)
  delete: async (req, res, next) => {
    try {
      const { type } = req.query;
      const { model: Model, label } = getEntry(type);

      const record = await Model.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!record) throw createError(404, `${label} not found`);

      await record.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: `${label} deleted` });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/warehouse/stock?warehouse_id=&material_id=&page=&limit=
  // Live inventory balance per warehouse/material/lot — backs the Warehouse page's stock table.
  getStock: async (req, res, next) => {
    try {
      const { warehouse_id, material_id, plant_id, page = 1, limit = 20 } = req.query;

      const where = { is_deleted: false };
      if (warehouse_id) where.warehouse_id = warehouse_id;
      if (material_id) where.material_id = material_id;
      if (plant_id) where.plant_id = plant_id;

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await Inventory.findAndCountAll({
        where,
        include: [
          { model: Lot, as: "lot", attributes: ["id", "lot_no", "destination"] },
          { model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name"] },
          { model: WarehouseMaster, as: "warehouse", attributes: ["id", "warehouse_code", "name"] },
        ],
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
};