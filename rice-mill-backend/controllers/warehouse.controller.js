const createError = require("http-errors");
const { Op } = require("sequelize");
const sequelize = require("../config/db");
const { WarehouseMaster, BinStackMaster, Stack, Lot, Inventory, MaterialMaster, VarietyMaster, ProductionBatch, FinishedGoods, Packing } = require("../models/index");
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

      // Only "raw" (pre-production) stock counts as material actually
      // available to feed into a new batch — "fg" stage rows exist purely
      // for Production's own internal bookkeeping (see getStockDetail's
      // comment below) and were being counted in here too, which is why
      // this used to show phantom quantities/materials that don't match
      // what the warehouse's Stock tab (physical reality) shows at all.
      const inventoryRows = await Inventory.findAll({
        where: { warehouse_id: warehouse.id, is_deleted: false, stage: "raw" },
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
        .map((m) => ({ ...m, qty: Math.round(m.qty * 1000) / 1000 }))
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
        if (bagSize) existing.bag_count += Math.round(balance / bagSize);
        rawByKey.set(key, existing);
      }
      const rawStock = Array.from(rawByKey.values())
        // Inventory.balance_qty is stored in kg (same as everything else —
        // FinishedGoods.qty, Packing totals, etc.) — this was missing the
        // ÷1000 conversion to tons that the packed-stock block below already
        // does correctly, so raw stock was showing its kg figure labelled
        // as tons (e.g. 500kg displayed as "500.00 tons" instead of the
        // correct "0.500 tons").
        .map((m) => ({ ...m, qty: Math.round((m.qty / 1000) * 1000) / 1000 }))
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

  // POST /api/warehouse/opening-stock/bulk-import
  // { rows: [{ warehouse_name, material_name, variety_name?, bag_size, bag_count }, ...], dry_run? }
  //
  // One-off bulk loader for opening raw stock — e.g. migrating an existing
  // physical stock count (from a spreadsheet) into the system as a
  // starting point. Each row becomes one completed Lot (bag_size/
  // accepted_bags set directly, no gate entry/purchase behind it —
  // purchase_id stays null, same as a production-generated lot) plus a
  // matching raw-stage Inventory row, so it shows up immediately in
  // Warehouse Stock and Production's "available materials" exactly like
  // any normally-unloaded lot would.
  //
  // Warehouses must already exist (matched by name, case-insensitive/
  // trimmed) — this deliberately does NOT auto-create warehouses, since a
  // warehouse needs a deliberate code/type/capacity set up first. Materials
  // (and varieties, if given) ARE auto-created when a name isn't found,
  // since those are just name+code catalogs with no similar setup step.
  //
  // The whole import is one transaction: if any row fails validation (an
  // unmatched warehouse, a bad bag_size/bag_count), NOTHING is committed —
  // you get the full list of problems back to fix in the sheet, then
  // re-run the import once, rather than getting half your stock in.
  bulkImportOpeningStock: async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
      const { rows, dry_run } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        throw createError(
          400,
          "rows must be a non-empty array of { warehouse_name, material_name, bag_size, bag_count }"
        );
      }

      const allWarehouses = await WarehouseMaster.findAll({ where: { is_deleted: false }, transaction: t });
      const allMaterials = await MaterialMaster.findAll({ where: { is_deleted: false }, transaction: t });
      const allVarieties = await VarietyMaster.findAll({ where: { is_deleted: false }, transaction: t });

      // generateCode()/generateLotNo() are NOT transaction-aware — they
      // query via a plain (non-transactional) connection, which can't see
      // this transaction's own uncommitted inserts. Calling them
      // repeatedly inside this one open transaction would hand out the
      // SAME "next" code/lot_no to every new material and every lot,
      // failing on the 2nd one with a uniqueness violation. Instead, seed
      // a starting sequence once (via a transaction-aware query) and
      // increment locally in memory as we go.
      const lastMaterial = await MaterialMaster.findOne({
        where: { material_code: { [Op.like]: "MAT%" } },
        order: [["id", "DESC"]],
        transaction: t,
      });
      let nextMaterialSeq = 1;
      if (lastMaterial && lastMaterial.material_code) {
        const match = String(lastMaterial.material_code).match(/^MAT(\d+)$/);
        if (match) nextMaterialSeq = parseInt(match[1], 10) + 1;
      }

      const today = new Date();
      const lotPrefix = `LOT-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}-`;
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      const lastLotToday = await Lot.findOne({
        where: { lot_no: { [Op.like]: `${lotPrefix}%` }, created_at: { [Op.between]: [startOfDay, endOfDay] } },
        order: [["id", "DESC"]],
        transaction: t,
      });
      let nextLotSeq = 1;
      if (lastLotToday) {
        const lastSeq = parseInt(lastLotToday.lot_no.split("-").pop(), 10);
        if (!Number.isNaN(lastSeq)) nextLotSeq = lastSeq + 1;
      }

      const findByName = (list, nameField, needle) =>
        list.find((row) => row[nameField].trim().toLowerCase() === needle) || null;

      const materialCache = new Map(); // lowercased name -> MaterialMaster row (created ones added as we go)
      const varietyCache = new Map();

      const errors = []; // blocks the whole import
      const notices = []; // informational only (e.g. "material X will be created")
      const resolved = [];

      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 2; // +2: header row + 1-indexed, matches spreadsheet row numbers
        const row = rows[i] || {};
        const warehouseName = String(row.warehouse_name || "").trim();
        const materialName = String(row.material_name || "").trim();
        const varietyName = row.variety_name ? String(row.variety_name).trim() : "";
        const bagSize = Number(row.bag_size);
        const bagCount = Number(row.bag_count);

        if (!warehouseName) { errors.push(`Row ${rowNum}: warehouse_name is required`); continue; }
        if (!materialName) { errors.push(`Row ${rowNum}: material_name is required`); continue; }
        if (!(bagSize > 0)) { errors.push(`Row ${rowNum}: bag_size must be a positive number (kg)`); continue; }
        if (!(bagCount > 0)) { errors.push(`Row ${rowNum}: bag_count must be a positive number`); continue; }

        const warehouse = findByName(allWarehouses, "name", warehouseName.toLowerCase());
        if (!warehouse) {
          errors.push(
            `Row ${rowNum}: no warehouse named "${warehouseName}" exists — create it first (Warehouse Management), or fix the name in the sheet`
          );
          continue;
        }

        const matKey = materialName.toLowerCase();
        let material = materialCache.get(matKey) || findByName(allMaterials, "name", matKey);
        if (!material) {
          if (dry_run) {
            notices.push(`Row ${rowNum}: material "${materialName}" doesn't exist yet — would be auto-created`);
          } else {
            const material_code = `MAT${String(nextMaterialSeq).padStart(4, "0")}`;
            nextMaterialSeq += 1;
            material = await MaterialMaster.create(
              { material_code, name: materialName, category: "raw", created_by: req.user ? req.user.id : null },
              { transaction: t }
            );
            allMaterials.push(material);
            notices.push(`Row ${rowNum}: created new material "${materialName}" (${material_code})`);
          }
          materialCache.set(matKey, material);
        }

        let variety = null;
        if (varietyName) {
          const varKey = varietyName.toLowerCase();
          variety = varietyCache.get(varKey) || findByName(allVarieties, "variety_name", varKey);
          if (!variety) {
            if (dry_run) {
              notices.push(`Row ${rowNum}: variety "${varietyName}" doesn't exist yet — would be auto-created`);
            } else {
              variety = await VarietyMaster.create(
                { variety_name: varietyName, grain_type: "medium", created_by: req.user ? req.user.id : null },
                { transaction: t }
              );
              allVarieties.push(variety);
              notices.push(`Row ${rowNum}: created new variety "${varietyName}"`);
            }
            varietyCache.set(varKey, variety);
          }
        }

        resolved.push({
          rowNum,
          warehouse,
          material,
          materialName,
          variety,
          varietyName,
          bagSize,
          bagCount,
          qty: bagSize * bagCount, // kg
        });
      }

      if (errors.length > 0) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: "Import cancelled — fix the problems below and re-run. Nothing was saved.",
          errors,
        });
      }

      if (dry_run) {
        await t.rollback();
        return res.status(200).json({
          success: true,
          msg: `Dry run only — nothing saved. ${resolved.length} row(s) would import cleanly.`,
          preview: resolved.map((r) => ({
            warehouse: r.warehouse.name,
            material: r.materialName,
            variety: r.varietyName || null,
            bag_size: r.bagSize,
            bag_count: r.bagCount,
            qty_kg: r.qty,
            qty_tons: Math.round((r.qty / 1000) * 1000) / 1000,
          })),
          notices,
        });
      }

      const created = [];
      for (const r of resolved) {
        const lot_no = `${lotPrefix}${String(nextLotSeq).padStart(3, "0")}`;
        nextLotSeq += 1;
        const lot = await Lot.create(
          {
            lot_no,
            purchase_id: null,
            material_id: r.material.id,
            variety_id: r.variety ? r.variety.id : null,
            qty: r.qty,
            destination: "warehouse",
            warehouse_id: r.warehouse.id,
            bin_id: null,
            unloading_status: "completed",
            bag_size: r.bagSize,
            accepted_bags: r.bagCount,
            rejected_bags: 0,
            rejected_qty: 0,
            created_by: req.user ? req.user.id : null,
            plant_id: r.warehouse.plant_id || (req.user ? req.user.plant_id : null),
          },
          { transaction: t }
        );

        await Inventory.create(
          {
            lot_id: lot.id,
            material_id: r.material.id,
            warehouse_id: r.warehouse.id,
            stage: "raw",
            qty_in: r.qty,
            qty_out: 0,
            balance_qty: r.qty,
            as_of: new Date(),
            created_by: req.user ? req.user.id : null,
            plant_id: r.warehouse.plant_id || (req.user ? req.user.plant_id : null),
          },
          { transaction: t }
        );

        created.push({
          lot_no,
          warehouse: r.warehouse.name,
          material: r.materialName,
          bag_size: r.bagSize,
          bag_count: r.bagCount,
          qty_kg: r.qty,
        });
      }

      await t.commit();
      res.status(201).json({
        success: true,
        msg: `Imported ${created.length} opening-stock lot(s) across ${new Set(created.map((c) => c.warehouse)).size} warehouse(s).`,
        data: created,
        notices,
      });
    } catch (err) {
      if (!t.finished) await t.rollback();

      // Surface exactly which field tripped a Sequelize-level validator or
      // DB constraint, instead of the generic "Validation error" the
      // default handler shows — same approach as purchase.controller.js's
      // bulkCreate, needed here because this endpoint writes to three
      // different models (MaterialMaster/VarietyMaster/Lot/Inventory) and
      // any one of them could be the actual culprit.
      if (err.name === "SequelizeValidationError" && Array.isArray(err.errors)) {
        const detail = err.errors.map((e) => `${e.path}: ${e.message} (got: ${JSON.stringify(e.value)})`).join("; ");
        return next(createError(400, `Validation failed — ${detail}`));
      }
      if (err.name === "SequelizeUniqueConstraintError") {
        const fields = err.fields ? Object.keys(err.fields).join(", ") : "unknown field(s)";
        return next(createError(409, `Duplicate value on: ${fields} — ${err.errors?.[0]?.message || ""}`));
      }
      if (err.name === "SequelizeForeignKeyConstraintError") {
        return next(createError(400, `Invalid reference — ${err.parent?.sqlMessage || err.message}`));
      }

      next(err);
    }
  },

  // GET /api/warehouse/stock?warehouse_id=&material_id=&page=&limit=
  getStock: async (req, res, next) => {    try {
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