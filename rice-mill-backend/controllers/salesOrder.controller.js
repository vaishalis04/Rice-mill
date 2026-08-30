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
// A Sales Order can now cover several materials for the same customer —
// under the hood each material is still its own row sharing one so_no (so
// Gate -> Loading can track each material's dispatch independently), same
// pattern as multi-item Purchase Orders (see purchase.controller.js).

const detailIncludes = [
  { model: Customer, as: "customer", attributes: ["id", "customer_code", "name", "customer_type"] },
  { model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name"] },
];

module.exports = {
 
 getAllGrouped: async (req, res, next) => {
  try {
    const { search, customer_id, plant_id } = req.query;

    const where = {
      is_deleted: false,
    };

    // Non-admin users can only see approved SOs
    if (req.user.role !== "admin") {
      where.approval_status = "approved";
    }

    if (customer_id) {
      where.customer_id = customer_id;
    }

    if (plant_id) {
      where.plant_id = plant_id;
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

    const result = [];

    for (const row of rows) {
      // Parse JSON items safely
      let items = row.items || [];

      if (typeof items === "string") {
        try {
          items = JSON.parse(items);
        } catch (e) {
          items = [];
        }
      }

      if (!Array.isArray(items)) {
        items = [];
      }

      // Get material IDs from JSON items
      const materialIds = items
        .map((item) => Number(item.material_id))
        .filter(Boolean);

      // Fetch materials
      let materials = [];

      if (materialIds.length > 0) {
        materials = await MaterialMaster.findAll({
          where: {
            id: {
              [Op.in]: materialIds,
            },
          },
        });
      }

      // Create material lookup
      const materialMap = new Map(
        materials.map((material) => [
          Number(material.id),
          material,
        ])
      );

      // Format items
      const formattedItems = items.map((item, index) => {
        const materialId = Number(item.material_id);

        return {
          id: `${row.id}_${index}`,
          material_id: materialId,
          material: materialMap.get(materialId) || null,
          qty: Number(item.qty || 0),
          rate: Number(item.rate || 0),

          // Since dispatched_qty is currently stored at SO level,
          // this will initially be 0 for each JSON item.
          dispatched_qty: 0,

          so_status: row.so_status,
        };
      });

      result.push({
        id: row.id,
        so_no: row.so_no,
        customer_id: row.customer_id,
        customer: row.customer,
        order_type: row.order_type,
        order_date: row.order_date,
        plant_id: row.plant_id,

        approval_status: row.approval_status,
        approved_by: row.approved_by,
        approved_at: row.approved_at,
        rejection_reason: row.rejection_reason,

        items: formattedItems,

        item_count: formattedItems.length,

        total_qty: formattedItems.reduce(
          (sum, item) => sum + Number(item.qty || 0),
          0
        ),

        total_dispatched_qty: Number(
          row.dispatched_qty || 0
        ),
      });
    }

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

    if (req.user.role !== "admin") {
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
      res.status(200).json({ success: true, data: so });
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

    return res.status(201).json({
      success: true,
      msg: `Sales order ${so_no} created with ${items.length} line item(s)`,
      data: fullRow,
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

    res.status(200).json({
      success: true,
      data: salesOrders,
    });
  } catch (err) {
    next(err);
  }
  },

  updateBeforeApproval: async (req, res, next) => {
  const t = await sequelize.transaction();

  try {
    const { so_no } = req.params;
    const {
      customer_id,
      order_type,
      order_date,
      plant_id,
      items,
    } = req.body;

    const existingRows = await SalesOrder.findAll({
      where: {
        so_no,
        approval_status: "pending_approval",
        is_deleted: false,
      },
      transaction: t,
    });

    if (!existingRows.length) {
      throw createError(
        404,
        "Pending sales order not found"
      );
    }

    if (customer_id) {
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
    }

    if (
      order_type &&
      !["fg", "by_product"].includes(order_type)
    ) {
      throw createError(
        400,
        "order_type must be 'fg' or 'by_product'"
      );
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw createError(
        400,
        "items must be a non-empty array"
      );
    }

    // Validate materials
    for (const item of items) {
      if (!item.material_id || !item.qty || !item.rate) {
        throw createError(
          400,
          "Every item needs material_id, qty and rate"
        );
      }

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

    // Check duplicate materials
    const seen = new Set();

    for (const item of items) {
      if (seen.has(item.material_id)) {
        throw createError(
          400,
          "Duplicate material in the same SO"
        );
      }

      seen.add(item.material_id);
    }

    // Delete old line items
    await SalesOrder.destroy({
      where: {
        so_no,
        approval_status: "pending_approval",
      },
      transaction: t,
    });

    // Create updated line items
    for (const item of items) {
      await SalesOrder.create(
        {
          so_no,
          customer_id:
            customer_id ?? existingRows[0].customer_id,

          order_type:
            order_type ?? existingRows[0].order_type,

          material_id: item.material_id,
          qty: item.qty,
          rate: item.rate,

          order_date:
            order_date ?? existingRows[0].order_date,

          so_status: "confirmed",

          // Still pending after editing
          approval_status: "pending_approval",

          plant_id:
            plant_id ?? existingRows[0].plant_id,

          created_by: existingRows[0].created_by,
          updated_by: req.user.id,
        },
        { transaction: t }
      );
    }

    await t.commit();

    const updatedRows = await SalesOrder.findAll({
      where: {
        so_no,
      },
      include: detailIncludes,
    });

    res.status(200).json({
      success: true,
      msg: `Sales order ${so_no} updated successfully`,
      data: updatedRows,
    });
  } catch (err) {
    if (!t.finished) {
      await t.rollback();
    }

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

    res.status(200).json({
      success: true,
      msg: `Sales order ${so_no} approved successfully`,
      data: rows,
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

  addItem: async (req, res, next) => {
    try {
      const { so_no } = req.params;
      const { material_id, qty, rate } = req.body;

      if (!material_id || !qty || !rate) {
        throw createError(400, "material_id, qty and rate are required");
      }

      // Any existing row for this so_no carries the shared header fields
      // (customer, order_type, order_date) that the new line should inherit.
      const anyRow = await SalesOrder.findOne({ where: { so_no, is_deleted: false } });
      if (!anyRow) throw createError(404, "Sales order not found");

      const material = await MaterialMaster.findOne({ where: { id: material_id, is_deleted: false } });
      if (!material) throw createError(400, "Invalid material_id");

      const dup = await SalesOrder.findOne({
        where: { so_no, material_id, is_deleted: false },
      });
      if (dup) throw createError(409, "This material is already on this Sales Order");

      const row = await SalesOrder.create({
        so_no,
        customer_id: anyRow.customer_id,
        order_type: anyRow.order_type,
        material_id,
        qty,
        rate,
        order_date: anyRow.order_date,
        so_status: "confirmed",
        plant_id: anyRow.plant_id,
        created_by: req.user ? req.user.id : null,
      });

      const created = await SalesOrder.findByPk(row.id, { include: detailIncludes });
      res.status(201).json({ success: true, msg: `Material added to SO ${so_no}`, data: created });
    } catch (err) {
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
      res.status(200).json({ success: true, msg: `SO ${so_no} updated`, data: updated });
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