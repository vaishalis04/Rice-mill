const createError = require("http-errors");
const { Op } = require("sequelize");
const sequelize = require("../config/db");
const { SalesOrder, Customer, MaterialMaster } = require("../models/index");
const { generateSoNo } = require("../helpers/helperFunction");

// Order booking, allocation (Module 18)
// Creating a sales order books it immediately as 'confirmed' — there's no
// separate draft/approval step in this simplified flow. Allocation happens
// when a Dispatch is created against it (see dispatch.controller.js).
//
// Unlike Purchase Orders, a Sales Order is ONE row per so_no — every
// material lives inside that row's `items` JSON column
// ([{ material_id, qty, rate, dispatched_qty }, ...]). Loading writes each
// material's dispatched_qty back into this same array (see
// loading.controller.js). Every place that reads or writes `items` needs
// to go through the same shape, or it silently falls out of sync with the
// rest of the system — that mismatch is what caused SO Approval showing
// blank materials, Edit/Add Material failing outright, and Loading's
// remaining-qty math going wrong.

const detailIncludes = [
  { model: Customer, as: "customer", attributes: ["id", "customer_code", "name", "customer_type"] },
  { model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name"] },
];

// Same MariaDB/Sequelize JSON-column quirk handled elsewhere (purchase.controller.js,
// loading.controller.js): a JSON column can round-trip as a raw string
// instead of an already-parsed array.
const parseItemsField = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

// Turns raw SalesOrder rows into the shape every consumer (SO Approval,
// SO list, Loading) expects: parsed `items` with each material's name
// looked up and its *real* dispatched_qty carried through — not hardcoded
// to 0, which was quietly showing every material as "never loaded" even
// after Loading had recorded real progress against it.
const enrichSoRows = async (rows) => {
  const allMaterialIds = new Set();
  const parsedByRow = rows.map((row) => {
    const items = parseItemsField(row.items);
    items.forEach((it) => it.material_id && allMaterialIds.add(Number(it.material_id)));
    return items;
  });

  const materials = allMaterialIds.size
    ? await MaterialMaster.findAll({
        where: { id: Array.from(allMaterialIds) },
        attributes: ["id", "material_code", "name"],
      })
    : [];
  const materialById = new Map(materials.map((m) => [String(m.id), m]));

  return rows.map((row, idx) => {
    const plain = typeof row.toJSON === "function" ? row.toJSON() : row;
    const items = parsedByRow[idx];

    const formattedItems = items.map((item, i) => ({
      id: `${row.id}_${i}`,
      material_id: Number(item.material_id),
      material: materialById.get(String(item.material_id)) || null,
      qty: Number(item.qty || 0),
      rate: Number(item.rate || 0),
      dispatched_qty: Number(item.dispatched_qty || 0),
      so_status: plain.so_status,
    }));

    return {
      ...plain,
      items: formattedItems,
      item_count: formattedItems.length,
      total_qty: formattedItems.reduce((sum, item) => sum + item.qty, 0),
      total_dispatched_qty: formattedItems.reduce((sum, item) => sum + item.dispatched_qty, 0),
      total_amount: formattedItems.reduce((sum, item) => sum + item.qty * item.rate, 0),
    };
  });
};

module.exports = {
 
 getAllGrouped: async (req, res, next) => {
  try {
    const { search, customer_id, plant_id, so_status } = req.query;

    const where = {
      is_deleted: false,
    };

    // Non-admin users can only see approved SOs
    if (req.user.role?.role_name !== "admin") {
      where.approval_status = "approved";
    }

    if (customer_id) {
      where.customer_id = customer_id;
    }

    if (plant_id) {
      where.plant_id = plant_id;
    }

    if (so_status) {
      where.so_status = so_status;
    }

    if (search) {
      where.so_no = {
        [Op.like]: `%${search}%`,
      };
    }

    const rows = await SalesOrder.findAll({
      where,
      include: detailIncludes,
      order: [
        ["so_no", "DESC"],
        ["created_at", "ASC"],
      ],
    });

    const result = await enrichSoRows(rows);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
},

  getAll: async (req, res, next) => {
  try {
    const where = {
      is_deleted: false,
    };

    if (req.user.role?.role_name !== "admin") {
      where.approval_status = "approved";
    }

    const rows = await SalesOrder.findAll({
      where,
      include: detailIncludes,
      order: [["created_at", "DESC"]],
    });

    res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (err) {
    next(err);
  }
  },

  getById: async (req, res, next) => {
    try {
      const so = await SalesOrder.findOne({ where: { id: req.params.id, is_deleted: false }, include: detailIncludes });
      if (!so) throw createError(404, "Sales order not found");
      const [enriched] = await enrichSoRows([so]);
      res.status(200).json({ success: true, data: enriched });
    } catch (err) {
      next(err);
    }
  },

  create: async (req, res, next) => {
    try {
      const { customer_id, order_type, material_id, qty, rate, order_date, plant_id } = req.body;

      if (!customer_id || !order_type || !material_id || !qty || !rate) {
        throw createError(400, "customer_id, order_type, material_id, qty and rate are required");
      }
      if (!["fg", "by_product"].includes(order_type)) throw createError(400, "order_type must be 'fg' or 'by_product'");

      const customer = await Customer.findOne({ where: { id: customer_id, is_deleted: false } });
      if (!customer) throw createError(400, "Invalid customer_id");

      const material = await MaterialMaster.findOne({ where: { id: material_id, is_deleted: false } });
      if (!material) throw createError(400, "Invalid material_id");

      const so_no = await generateSoNo();

      const so = await SalesOrder.create({
        so_no,
        customer_id,
        order_type,
        material_id,
        qty,
        rate,
        order_date: order_date || new Date().toISOString().slice(0, 10),
        so_status: "confirmed",
        plant_id: plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      const created = await SalesOrder.findByPk(so.id, { include: detailIncludes });
      res.status(201).json({ success: true, msg: `Sales order ${so_no} created`, data: created });
    } catch (err) {
      next(err);
    }
  },

bulkCreate: async (req, res, next) => {
  const t = await sequelize.transaction();

  try {
    const {
      customer_id,
      order_type,
      order_date,
      plant_id,
      items,
    } = req.body;

    // -----------------------------
    // Basic validation
    // -----------------------------
    if (!customer_id || !order_type) {
      throw createError(
        400,
        "customer_id and order_type are required"
      );
    }

    if (!["fg", "by_product"].includes(order_type)) {
      throw createError(
        400,
        "order_type must be 'fg' or 'by_product'"
      );
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw createError(
        400,
        "items must be a non-empty array of { material_id, qty, rate }"
      );
    }

    // -----------------------------
    // Validate customer
    // -----------------------------
    const customer = await Customer.findOne({
      where: {
        id: customer_id,
        is_deleted: false,
      },
      transaction: t,
    });

    if (!customer) {
      throw createError(400, "Invalid customer_id");
    }

    // -----------------------------
    // Validate items
    // -----------------------------
    const seen = new Set();

    for (const item of items) {
      if (!item.material_id) {
        throw createError(
          400,
          "Every item needs material_id"
        );
      }

      if (
        item.qty === undefined ||
        item.qty === null ||
        Number(item.qty) <= 0
      ) {
        throw createError(
          400,
          `Invalid qty for material_id: ${item.material_id}`
        );
      }

      if (
        item.rate === undefined ||
        item.rate === null ||
        Number(item.rate) < 0
      ) {
        throw createError(
          400,
          `Invalid rate for material_id: ${item.material_id}`
        );
      }

      // Reject duplicate material IDs
      if (seen.has(Number(item.material_id))) {
        throw createError(
          400,
          `Duplicate material in the same SO submission: ${item.material_id}`
        );
      }

      seen.add(Number(item.material_id));

      // Validate material
      const material = await MaterialMaster.findOne({
        where: {
          id: item.material_id,
          is_deleted: false,
        },
        transaction: t,
      });

      if (!material) {
        throw createError(
          400,
          `Invalid material_id: ${item.material_id}`
        );
      }
    }

    // -----------------------------
    // Generate SO number
    // -----------------------------
    const so_no = await generateSoNo();

    // -----------------------------
    // Resolve plant
    // -----------------------------
    const resolvedPlantId =
      plant_id ||
      (req.user ? req.user.plant_id : null);

    // -----------------------------
    // Resolve order date
    // -----------------------------
    const resolvedOrderDate =
      order_date ||
      new Date().toISOString().slice(0, 10);

    // -----------------------------
    // Normalize items
    // -----------------------------
    const normalizedItems = items.map((item) => ({
      material_id: Number(item.material_id),
      qty: Number(item.qty),
      rate: Number(item.rate),
    }));

    // -----------------------------
    // Create ONE SalesOrder row
    // -----------------------------
    const created = await SalesOrder.create(
      {
        so_no,
        customer_id,
        order_type,

        // Store all line items inside JSON
        items: normalizedItems,

        // These are no longer used for individual
        // line items because everything is inside items.
        //
        // If these DB columns are still NOT NULL,
        // you must make them nullable in MySQL.
        material_id: null,
        qty: null,
        rate: null,

        // Initially nothing has been dispatched
        dispatched_qty: 0,

        order_date: resolvedOrderDate,

        so_status: "confirmed",

        approval_status: "pending_approval",

        plant_id: resolvedPlantId,

        created_by: req.user
          ? req.user.id
          : null,
      },
      {
        transaction: t,
      }
    );

    // -----------------------------
    // Commit transaction
    // -----------------------------
    await t.commit();

    // -----------------------------
    // Fetch complete created SO
    // -----------------------------
    const fullRow = await SalesOrder.findOne({
      where: {
        id: created.id,
      },
      include: detailIncludes,
    });
    const [enrichedRow] = await enrichSoRows([fullRow]);

    return res.status(201).json({
      success: true,
      msg: `Sales order ${so_no} created with ${items.length} line item(s)`,
      data: enrichedRow,
    });

  } catch (err) {
    if (!t.finished) {
      await t.rollback();
    }

    // -----------------------------
    // Unique constraint error
    // -----------------------------
    if (err.name === "SequelizeUniqueConstraintError") {
      const fields = err.fields
        ? Object.keys(err.fields).join(", ")
        : "unknown field(s)";

      return next(
        createError(
          500,
          `A database constraint still exists on: ${fields}. ` +
          `Run "SHOW INDEX FROM sales_order;" in MySQL Workbench ` +
          `and remove any unwanted unique index.`
        )
      );
    }

    // -----------------------------
    // Validation error
    // -----------------------------
    if (
      err.name === "SequelizeValidationError" &&
      Array.isArray(err.errors)
    ) {
      const detail = err.errors
        .map((e) => `${e.path}: ${e.message}`)
        .join("; ");

      return next(
        createError(
          400,
          `Validation failed — ${detail}`
        )
      );
    }

    next(err);
  }
},

  getPendingApprovals: async (req, res, next) => {
  try {
    const salesOrders = await SalesOrder.findAll({
      where: {
        approval_status: "pending_approval",
        is_deleted: false,
      },
      include: detailIncludes,
      order: [["created_at", "DESC"]],
    });

    const enriched = await enrichSoRows(salesOrders);

    res.status(200).json({
      success: true,
      data: enriched,
    });
  } catch (err) {
    next(err);
  }
  },

  // PUT /so/:so_no/approval-edit — header-only edit (customer, order type,
  // date, plant). The frontend's Edit form only ever sends these four
  // fields — it never sends `items` — but this used to unconditionally
  // require a non-empty `items` array and reject every call with 400,
  // so Edit could never actually succeed. It also used to delete the
  // single row for this so_no and recreate one row PER material with
  // flat material_id/qty/rate columns and an empty `items` array —
  // that's the old multi-row Purchase-Order-style pattern, and it
  // doesn't match how this table actually works (one row per so_no,
  // materials inside `items`). Recreating rows that way corrupted the
  // SO for every other endpoint that reads it (blank materials in
  // Approval/list views, wrong remaining-qty in Loading). This just
  // updates the single row's header fields in place.
  updateBeforeApproval: async (req, res, next) => {
  try {
    const { so_no } = req.params;
    const { customer_id, order_type, order_date, plant_id, items } = req.body;

    const so = await SalesOrder.findOne({
      where: { so_no, approval_status: "pending_approval", is_deleted: false },
    });
    if (!so) throw createError(404, "Pending sales order not found");

    if (customer_id) {
      const customer = await Customer.findOne({
        where: { id: customer_id, is_deleted: false },
      });
      if (!customer) throw createError(400, "Invalid customer_id");
    }

    if (order_type && !["fg", "by_product"].includes(order_type)) {
      throw createError(400, "order_type must be 'fg' or 'by_product'");
    }

    const updates = { customer_id, order_type, order_date, plant_id };
    Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
    if (items !== undefined) {
      if (!Array.isArray(items) || items.length === 0) {
        throw createError(400, "items must contain at least one item");
      }
      const seen = new Set();
      updates.items = items.map((item) => {
        const materialId = Number(item.material_id);
        const qty = Number(item.qty);
        const rate = Number(item.rate);
        if (!Number.isInteger(materialId) || materialId <= 0 || !(qty > 0) || !(rate >= 0)) {
          throw createError(400, "Each SO item needs a valid material, quantity, and rate");
        }
        if (seen.has(materialId)) throw createError(400, "Duplicate material in SO items");
        seen.add(materialId);
        return { material_id: materialId, qty, rate, dispatched_qty: Number(item.dispatched_qty || 0) };
      });
    }
    updates.updated_by = req.user ? req.user.id : null;

    await so.update(updates);
    if (items !== undefined) so.changed("items", true);
    if (items !== undefined) await so.save();

    const fresh = await SalesOrder.findOne({ where: { id: so.id }, include: detailIncludes });
    const [enriched] = await enrichSoRows([fresh]);

    res.status(200).json({
      success: true,
      msg: `Sales order ${so_no} updated successfully`,
      data: enriched,
    });
  } catch (err) {
    next(err);
  }
  },

  approve: async (req, res, next) => {
  try {
    const { so_no } = req.params;

    const [updated] = await SalesOrder.update(
      {
        approval_status: "approved",
        approved_by: req.user.id,
        approved_at: new Date(),
      },
      {
        where: {
          so_no,
          approval_status: "pending_approval",
          is_deleted: false,
        },
      }
    );

    if (!updated) {
      throw createError(
        404,
        "Pending sales order not found"
      );
    }

    const rows = await SalesOrder.findAll({
      where: {
        so_no,
      },
      include: detailIncludes,
    });
    const enriched = await enrichSoRows(rows);

    res.status(200).json({
      success: true,
      msg: `Sales order ${so_no} approved successfully`,
      data: enriched,
    });
  } catch (err) {
    next(err);
  }
  },

  reject: async (req, res, next) => {
  try {
    const { so_no } = req.params;
    const { rejection_reason } = req.body;

    if (!rejection_reason) {
      throw createError(
        400,
        "rejection_reason is required"
      );
    }

    const [updated] = await SalesOrder.update(
      {
        approval_status: "rejected",
        rejection_reason,
        updated_by: req.user.id,
      },
      {
        where: {
          so_no,
          approval_status: "pending_approval",
          is_deleted: false,
        },
      }
    );

    if (!updated) {
      throw createError(
        404,
        "Pending sales order not found"
      );
    }

    res.status(200).json({
      success: true,
      msg: `Sales order ${so_no} rejected successfully`,
    });
  } catch (err) {
    next(err);
  }
  },

  // POST /so/:so_no/items — append a material line to the single row's
  // `items` array. This used to create an entirely SEPARATE SalesOrder
  // row (with material_id/qty/rate as flat columns and `items` left at
  // its empty default) — since every other endpoint reads materials from
  // the one row's `items` column, that new row's material was invisible
  // everywhere except its own bare listing, and it fragmented the SO
  // (duplicate so_no rows) in a way Loading's per-material remaining-qty
  // lookup couldn't make sense of.
  addItem: async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { so_no } = req.params;
    const { material_id, qty, rate } = req.body;

    if (!material_id || !qty || !rate) {
      throw createError(400, "material_id, qty and rate are required");
    }

    const so = await SalesOrder.findOne({
      where: { so_no, is_deleted: false },
      transaction: t,
    });
    if (!so) throw createError(404, "Sales order not found");

    const material = await MaterialMaster.findOne({
      where: { id: material_id, is_deleted: false },
      transaction: t,
    });
    if (!material) throw createError(400, "Invalid material_id");

    let existingItems = so.items || [];
    if (typeof existingItems === "string") {
      try { existingItems = JSON.parse(existingItems); } catch { existingItems = []; }
    }
    if (!Array.isArray(existingItems)) existingItems = [];

    if (existingItems.length === 0 && so.material_id) {
      existingItems = [{ material_id: so.material_id, qty: so.qty, rate: so.rate }];
    }

    const dup = existingItems.some(
      (it) => Number(it.material_id) === Number(material_id)
    );
    if (dup) throw createError(409, "This material is already on this Sales Order");

    // IMPORTANT: build a NEW array, don't push onto the existing reference
    const newItems = [
      ...existingItems,
      { material_id: Number(material_id), qty: Number(qty), rate: Number(rate) },
    ];

    so.set("items", newItems);
    so.changed("items", true); // force Sequelize to treat the JSON field as dirty
    so.material_id = null;
    so.qty = null;
    so.rate = null;
    so.updated_by = req.user ? req.user.id : null;

    await so.save({ transaction: t });
    await t.commit();

    const updated = await SalesOrder.findByPk(so.id, { include: detailIncludes });
    res.status(200).json({
      success: true,
      msg: `Material added to SO ${so_no}`,
      data: updated,
    });
  } catch (err) {
    if (!t.finished) await t.rollback();
    next(err);
  }
},

  // DELETE /so/:so_no/items/:material_id — remove a single material line
  // from the `items` array. The Approval page's trash-can button used to
  // call the plain SO delete endpoint with the *order's own id*, which
  // soft-deleted the entire Sales Order instead of just that one line —
  // this gives it a real, item-scoped endpoint to call instead.
  removeItem: async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
      const { so_no, material_id } = req.params;

      const so = await SalesOrder.findOne({ where: { so_no, is_deleted: false, approval_status: "pending_approval" }, transaction: t });
      if (!so) throw createError(404, "Sales order not found");

      const items = parseItemsField(so.items);
      const target = items.find((it) => Number(it.material_id) === Number(material_id));
      if (!target) throw createError(404, "This material is not on this Sales Order");

      if (items.length <= 1) {
        throw createError(400, "A sales order must have at least one material line — add a replacement before removing the last one.");
      }

      if (Number(target.dispatched_qty || 0) > 0) {
        throw createError(400, "This material already has loaded quantity against it and can't be removed.");
      }

      const remaining = items.filter((it) => Number(it.material_id) !== Number(material_id));

      await so.update(
        {
          items: remaining,
          updated_by: req.user ? req.user.id : null,
        },
        { transaction: t },
      );

      await t.commit();

      const fresh = await SalesOrder.findOne({ where: { id: so.id }, include: detailIncludes });
      const [enriched] = await enrichSoRows([fresh]);

      res.status(200).json({ success: true, msg: `Material removed from SO ${so_no}`, data: enriched });
    } catch (err) {
      await t.rollback();
      next(err);
    }
  },

  updateHeader: async (req, res, next) => {
    try {
      const { so_no } = req.params;
      const { customer_id, order_type, order_date } = req.body;

      const rows = await SalesOrder.findAll({ where: { so_no, is_deleted: false } });
      if (rows.length === 0) throw createError(404, "Sales order not found");

      if (customer_id) {
        const customer = await Customer.findOne({ where: { id: customer_id, is_deleted: false } });
        if (!customer) throw createError(400, "Invalid customer_id");
      }
      if (order_type && !["fg", "by_product"].includes(order_type)) {
        throw createError(400, "order_type must be 'fg' or 'by_product'");
      }

      const updates = { customer_id, order_type, order_date };
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      updates.updated_by = req.user ? req.user.id : null;

      await SalesOrder.update(updates, { where: { so_no, is_deleted: false } });

      const updated = await SalesOrder.findAll({ where: { so_no, is_deleted: false }, include: detailIncludes });
      const enriched = await enrichSoRows(updated);
      res.status(200).json({ success: true, msg: `SO ${so_no} updated`, data: enriched });
    } catch (err) {
      next(err);
    }
  },

  update: async (req, res, next) => {
    try {
      const id = req.params.id;
      const so = await SalesOrder.findOne({
        where: {
          is_deleted: false,
          [Op.or]: [
            { id: Number.isNaN(Number(id)) ? null : Number(id) },
            { so_no: id },
          ],
        },
      });
      if (!so) throw createError(404, "Sales order not found");

      const { material_id, qty, rate, order_date, so_status, plant_id, items } = req.body;
      if (so_status && !["pending", "confirmed", "allocated", "dispatched", "closed", "cancelled"].includes(so_status)) {
        throw createError(400, "Invalid so_status");
      }

      let nextItems = items;
      if (Array.isArray(nextItems)) {
        const normalizedItems = nextItems.map((item) => ({
          material_id: Number(item.material_id),
          qty: Number(item.qty),
          rate: Number(item.rate),
          so_status: item.so_status || "confirmed",
        }));

        const seen = new Set();
        for (const item of normalizedItems) {
          if (!item.material_id || !item.qty || !item.rate) {
            throw createError(400, "Each SO item needs material_id, qty and rate");
          }
          if (seen.has(Number(item.material_id))) {
            throw createError(409, "Duplicate material in the same SO");
          }
          seen.add(Number(item.material_id));

          const material = await MaterialMaster.findOne({ where: { id: item.material_id, is_deleted: false } });
          if (!material) throw createError(400, `Invalid material_id: ${item.material_id}`);
        }

        nextItems = normalizedItems;
      }

      if (material_id) {
        const dup = await SalesOrder.findOne({
          where: { so_no: so.so_no, material_id, id: { [Op.ne]: so.id } },
        });
        if (dup) throw createError(409, "This material is already on this Sales Order");

        const material = await MaterialMaster.findOne({ where: { id: material_id, is_deleted: false } });
        if (!material) throw createError(400, "Invalid material_id");
      }

      const updates = {
        material_id,
        qty,
        rate,
        order_date,
        so_status,
        plant_id,
        ...(Array.isArray(nextItems) ? { items: nextItems } : {}),
      };
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      updates.updated_by = req.user ? req.user.id : null;

      await so.update(updates);

      const updated = await SalesOrder.findByPk(so.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Sales order updated", data: updated });
    } catch (err) {
      next(err);
    }
  },

  delete: async (req, res, next) => {
    try {
      const so = await SalesOrder.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!so) throw createError(404, "Sales order not found");

      await so.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Sales order deleted" });
    } catch (err) {
      next(err);
    }
  },
};