const createError = require("http-errors");
const { Op } = require("sequelize");
const { WarehouseMaster, BinStackMaster, Stack, Lot, Inventory, MaterialMaster, ProductionBatch, FinishedGoods, Packing } = require("../models/index");
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
  // Unloading page and the Production "Create Batch" screen so picking a
  // warehouse shows what's actually available before you commit stock to
  // it.
  //
  // "Available" here is raw Inventory balance MINUS whatever is already
  // reserved by pending (not-yet-packed) production batches in this
  // warehouse — pending batches don't touch Inventory yet, so without this
  // subtraction the same stock could look available to two different
  // batches at once.
  getSummary: async (req, res, next) => {
    try {
      const warehouse = await WarehouseMaster.findOne({
        where: { id: req.params.id, is_deleted: false },
      });
      if (!warehouse) throw createError(404, "Warehouse not found");

      const inventoryRows = await Inventory.findAll({
        where: { warehouse_id: warehouse.id, is_deleted: false },
        include: [
          { model: MaterialMaster, as: "material", attributes: ["id", "name", "material_code"] },
          { model: Lot, as: "lot", attributes: ["id", "bag_size"] },
        ],
      });

      // Bag-size breakdown per material, shown alongside the reservation
      // total below purely as a "what's actually in bags" reference for
      // whoever is creating the batch — it does NOT feed the qty/available
      // math, which stays exactly as it was (raw+fg Inventory balance,
      // minus pending-batch reservations).
      const bagsByMaterial = new Map(); // material_id -> Map(sizeKey -> {bag_size, bag_count, qty})
      const addBagLine = (materialId, bagSize, bagCount, qty) => {
        if (!bagsByMaterial.has(materialId)) bagsByMaterial.set(materialId, new Map());
        const m = bagsByMaterial.get(materialId);
        const key = bagSize == null ? "bulk" : String(bagSize);
        const existing = m.get(key) || { bag_size: bagSize, bag_count: bagSize != null ? 0 : null, qty: 0 };
        existing.qty += qty;
        if (bagSize != null && bagCount != null) existing.bag_count += bagCount;
        m.set(key, existing);
      };

      const byMaterial = new Map();
      for (const row of inventoryRows) {
        const key = row.material_id;
        const existing = byMaterial.get(key) || {
          material_id: key,
          material_name: row.material?.name || `Material ${key}`,
          material_code: row.material?.material_code || null,
          qty: 0,
        };
        const balance = Number(row.balance_qty || 0);
        existing.qty += balance;
        byMaterial.set(key, existing);

        // Inventory is the stock ledger of record. Use its balance for the
        // displayed bag quantity so bag lines and total tons cannot diverge.
        if (row.stage === "raw") {
          const bagSize = row.lot?.bag_size != null ? Number(row.lot.bag_size) : null;
          const wholeBags = bagSize ? Math.floor((balance * 1000) / bagSize + 0.0001) : null;
          const bagQty = bagSize && wholeBags != null ? (wholeBags * bagSize) / 1000 : balance;
          addBagLine(key, bagSize, wholeBags, bagQty);
        }
      }

      // Packed stock is already represented by FG Inventory rows above.
      // Read pack size only as a label; use the Inventory balance for both
      // the displayed tons and the derived bag count.
      const fgInventoryRows = inventoryRows.filter(
        (row) => row.stage === "fg" && Number(row.balance_qty || 0) > 0,
      );
      const fgLotIds = [...new Set(fgInventoryRows.map((row) => row.lot_id).filter(Boolean))];
      const packingRows = fgLotIds.length
        ? await Packing.findAll({
            where: { lot_id: { [Op.in]: fgLotIds }, is_deleted: false },
            attributes: ["id", "lot_id", "material_id", "pack_size"],
          })
        : [];

      for (const row of fgInventoryRows) {
        const packing = packingRows.find(
          (candidate) =>
            Number(candidate.lot_id) === Number(row.lot_id) &&
            (!candidate.material_id || Number(candidate.material_id) === Number(row.material_id)),
        );
        const packSize = packing?.pack_size != null ? Number(packing.pack_size) : null;
        const balance = Number(row.balance_qty);
        const wholeBags = packSize ? Math.floor((balance * 1000) / packSize + 0.0001) : null;
        const bagQty = packSize && wholeBags != null ? (wholeBags * packSize) / 1000 : balance;
        addBagLine(Number(row.material_id), packSize, wholeBags, bagQty);
      }

      // Subtract what pending production batches have already reserved.
      const pendingBatches = await ProductionBatch.findAll({
        where: { warehouse_id: warehouse.id, batch_status: "pending", is_deleted: false },
        attributes: ["id", "material_id", "input_qty", "materials_data"],
      });
      for (const batch of pendingBatches) {
        const lines = Array.isArray(batch.materials_data) && batch.materials_data.length > 0
          ? batch.materials_data
          : batch.material_id
          ? [{ material_id: batch.material_id, input_qty: batch.input_qty }]
          : [];
        for (const line of lines) {
          const key = Number(line.material_id);
          const existing = byMaterial.get(key);
          if (existing) existing.qty -= Number(line.input_qty || 0);
        }
      }

      const materials = Array.from(byMaterial.values())
        .map((m) => {
          const bagMap = bagsByMaterial.get(m.material_id);
          const bagQtyTotal = bagMap
            ? Array.from(bagMap.values()).reduce((sum, bag) => sum + Number(bag.qty || 0), 0)
            : null;
          const bags = bagMap
            ? Array.from(bagMap.values())
                .map((b) => ({
                  ...b,
                  qty: Math.round(b.qty * 1000) / 1000,
                  // One decimal, not a whole number — see note above the
                  // raw-stock loop: a partially-consumed lot doesn't divide
                  // evenly into whole bags.
                  bag_count: b.bag_count != null ? Math.floor(b.bag_count) : null,
                }))
                .filter((b) => b.qty > 0.001)
                .sort((a, b) => (a.bag_size ?? -1) - (b.bag_size ?? -1))
            : [];
          const usableQty = bagQtyTotal != null ? Math.min(m.qty, bagQtyTotal) : m.qty;
          return { ...m, qty: Math.round(usableQty * 1000) / 1000, bags };
        })
        .filter((m) => m.qty > 0.001)
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

  // GET /api/warehouse/stock-detail?warehouse_id=  (omit warehouse_id to
  // combine every warehouse into one view)
  //
  // Splits what's physically sitting in a warehouse into two groups:
  //  - raw_stock: unpacked bulk material (Inventory, stage="raw"), in tons.
  //  - packed_stock: already-packed finished goods, grouped by material +
  //    pack size, with bag count and total tons. Sourced from
  //    FinishedGoods + Packing (NOT from Inventory's "fg" stage rows,
  //    which exist only for Production's internal availability math and
  //    would double-count the same physical stock if shown here too).
  getStockDetail: async (req, res, next) => {
    try {
      const { warehouse_id } = req.query;
      let warehouse = null;
      let warehouseList = [];

      if (warehouse_id) {
        warehouse = await WarehouseMaster.findOne({ where: { id: warehouse_id, is_deleted: false } });
        if (!warehouse) throw createError(404, "Warehouse not found");
        warehouseList = [warehouse];
      } else {
        warehouseList = await WarehouseMaster.findAll({ where: { is_deleted: false } });
      }
      const warehouseIds = warehouseList.map((w) => w.id);

      // ---- Raw / bulk stock ----
      // Grouped by material + bag size where the unloaded lot recorded one
      // (Lot.bag_size, set at "complete unloading" time). bag_count here
      // is a DERIVED estimate (remaining tons / bag size) — production
      // consumption only reduces Inventory.balance_qty in tons, it never
      // decrements a bag count, so this isn't a literal untouched count
      // once any of that lot has been drawn on.
      const inventoryWhere = { is_deleted: false, stage: "raw", balance_qty: { [Op.gt]: 0 } };
      inventoryWhere.warehouse_id = warehouse_id ? warehouse_id : { [Op.in]: warehouseIds };

      const inventoryRows = await Inventory.findAll({
        where: inventoryWhere,
        include: [
          { model: MaterialMaster, as: "material", attributes: ["id", "name", "material_code"] },
          { model: Lot, as: "lot", attributes: ["id", "bag_size"] },
        ],
      });

      const rawByKey = new Map();
      for (const row of inventoryRows) {
        const bagSize = row.lot?.bag_size != null ? Number(row.lot.bag_size) : null;
        const key = `${row.material_id}|${bagSize}`;
        const balance = Number(row.balance_qty || 0);
        const existing = rawByKey.get(key) || {
          material_id: row.material_id,
          material_name: row.material?.name || `Material ${row.material_id}`,
          material_code: row.material?.material_code || null,
          bag_size: bagSize,
          bag_count: bagSize ? 0 : null,
          qty: 0,
        };
        existing.qty += balance;
        if (bagSize) existing.bag_count += (balance * 1000) / bagSize;
        rawByKey.set(key, existing);
      }
      const rawStock = Array.from(rawByKey.values())
        .map((m) => ({
          ...m,
          qty: Math.round(m.qty * 1000) / 1000,
          // One decimal, not a whole number — a partially-consumed lot
          // doesn't divide evenly into whole bags (consumption is tracked
          // in tons, not bag units), so rounding to a whole number here
          // would make the bag count and tons not multiply back correctly.
          bag_count: m.bag_count != null ? Math.round(m.bag_count * 10) / 10 : null,
        }))
        .filter((m) => m.qty > 0.001)
        .sort((a, b) => b.qty - a.qty);

      // ---- Packed stock, grouped by material + pack size ----
      const fgWhere = { is_deleted: false, fg_status: { [Op.ne]: "dispatched" } };
      fgWhere.warehouse_id = warehouse_id ? warehouse_id : { [Op.in]: warehouseIds };

      const fgRows = await FinishedGoods.findAll({
        where: fgWhere,
        attributes: ["id", "packing_id", "warehouse_id", "qty"],
      });

      let packedStock = [];
      if (fgRows.length > 0) {
        const packingIds = [...new Set(fgRows.map((r) => Number(r.packing_id)))];
        const packingRows = await Packing.findAll({
          where: { id: { [Op.in]: packingIds }, is_deleted: false },
          attributes: ["id", "lot_id", "pack_size", "bag_count"],
        });
        const packingById = new Map(packingRows.map((p) => [p.id, p]));

        // Packing has no material_id column of its own — the material for
        // a packing record is whatever material its lot was for (set
        // per-material even on multi-material batches, since packing.
        // controller.js passes each material's own reserved lot_id when
        // it creates that material's packing record).
        const lotIds = [...new Set(packingRows.map((p) => p.lot_id).filter(Boolean))];
        const lotRows = await Lot.findAll({
          where: { id: { [Op.in]: lotIds } },
          attributes: ["id", "material_id"],
        });
        const materialIdByLotId = new Map(lotRows.map((l) => [l.id, Number(l.material_id)]));

        const materialIds = [...new Set(lotRows.map((l) => Number(l.material_id)))];
        const materialRows = await MaterialMaster.findAll({
          where: { id: { [Op.in]: materialIds } },
          attributes: ["id", "name", "material_code"],
        });
        const materialById = new Map(materialRows.map((m) => [m.id, m]));

        const packedMap = new Map();
        for (const fg of fgRows) {
          const packing = packingById.get(Number(fg.packing_id));
          if (!packing) continue;
          const materialId = materialIdByLotId.get(Number(packing.lot_id));
          if (!materialId) continue; // lot/material not resolvable — skip defensively
          const packSize = Number(packing.pack_size);
          const key = `${materialId}|${packSize}`;
          const material = materialById.get(materialId);
          const existing = packedMap.get(key) || {
            material_id: materialId,
            material_name: material?.name || `Material ${materialId}`,
            material_code: material?.material_code || null,
            pack_size: packSize,
            bag_count: 0,
            qty_kg: 0,
          };
          existing.bag_count += Number(packing.bag_count || 0);
          existing.qty_kg += Number(fg.qty || 0);
          packedMap.set(key, existing);
        }
        packedStock = Array.from(packedMap.values())
          .map((p) => ({
            material_id: p.material_id,
            material_name: p.material_name,
            material_code: p.material_code,
            pack_size: p.pack_size,
            bag_count: p.bag_count,
            qty_tons: Math.round((p.qty_kg / 1000) * 1000) / 1000,
          }))
          .filter((p) => p.qty_tons > 0.001)
          .sort((a, b) => b.qty_tons - a.qty_tons);
      }

      const rawTotal = rawStock.reduce((sum, m) => sum + m.qty, 0);
      const packedTotal = packedStock.reduce((sum, m) => sum + m.qty_tons, 0);
      const totalStock = Math.round((rawTotal + packedTotal) * 1000) / 1000;

      let capacity = null;
      if (warehouse) {
        capacity = warehouse.capacity != null ? Number(warehouse.capacity) : null;
      } else if (warehouseList.length > 0 && warehouseList.every((w) => w.capacity != null)) {
        capacity = warehouseList.reduce((sum, w) => sum + Number(w.capacity), 0);
      }
      const remainingCapacity = capacity != null ? Math.max(capacity - totalStock, 0) : null;

      res.status(200).json({
        success: true,
        data: {
          warehouse_id: warehouse ? warehouse.id : null,
          name: warehouse ? warehouse.name : "All Warehouses",
          warehouse_code: warehouse ? warehouse.warehouse_code : null,
          type: warehouse ? warehouse.type : null,
          capacity,
          raw_stock: rawStock,
          packed_stock: packedStock,
          total_stock: totalStock,
          remaining_capacity: remainingCapacity,
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
          // { model: Lot, as: "lot", attributes: ["id", "lot_no", "destination"] },
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