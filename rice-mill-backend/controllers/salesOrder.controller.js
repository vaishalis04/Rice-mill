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
  // GET /api/sales-orders/grouped?search=&customer_id=&plant_id=
  // One row per so_no (a real "sales order"), with all its material line
  // items nested under `items`. This is what the SO list page and the Gate
  // Entry SO picker use — the flat one-row-per-material getAll() below is
  // still there for anything that specifically needs a single SO line
  // (Loading, Dispatch, dashboards).
  getAllGrouped: async (req, res, next) => {
    try {
      const { search, customer_id, plant_id } = req.query;

      const where = { is_deleted: false };
      if (customer_id) where.customer_id = customer_id;
      if (plant_id) where.plant_id = plant_id;
      if (search) where.so_no = { [Op.like]: `%${search}%` };

      const rows = await SalesOrder.findAll({
        where,
        include: detailIncludes,
        order: [["so_no", "DESC"], ["created_at", "ASC"]],
      });

      const groups = new Map();
      for (const row of rows) {
        if (!groups.has(row.so_no)) {
          groups.set(row.so_no, {
            so_no: row.so_no,
            customer_id: row.customer_id,
            customer: row.customer,
            order_type: row.order_type,
            order_date: row.order_date,
            plant_id: row.plant_id,
            items: [],
          });
        }
        groups.get(row.so_no).items.push({
          id: row.id,
          material_id: row.material_id,
          material: row.material,
          qty: row.qty,
          dispatched_qty: row.dispatched_qty,
          rate: row.rate,
          so_status: row.so_status,
        });
      }

      const grouped = Array.from(groups.values()).map((g) => ({
        ...g,
        // Synthetic id for the frontend's generic EntitySelect (which needs
        // exactly one `id` per option) — the first line item's real row id.
        // Submitting a gate entry against this SO still resolves to the
        // SPECIFIC line item matching whichever material the truck is
        // actually collecting, not this placeholder (see gate.controller.js).
        id: g.items[0].id,
        item_count: g.items.length,
        total_qty: g.items.reduce((s, i) => s + Number(i.qty), 0),
        total_dispatched_qty: g.items.reduce((s, i) => s + Number(i.dispatched_qty || 0), 0),
      }));

      res.status(200).json({ success: true, data: grouped });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/sales-orders?customer_id=&so_status=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { customer_id, so_status, plant_id, page = 1, limit = 20 } = req.query;

      const where = { is_deleted: false };
      if (customer_id) where.customer_id = customer_id;
      if (so_status) where.so_status = so_status;
      if (plant_id) where.plant_id = plant_id;

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await SalesOrder.findAndCountAll({
        where,
        include: detailIncludes,
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

  // GET /api/sales-orders/:id
  getById: async (req, res, next) => {
    try {
      const so = await SalesOrder.findOne({ where: { id: req.params.id, is_deleted: false }, include: detailIncludes });
      if (!so) throw createError(404, "Sales order not found");
      res.status(200).json({ success: true, data: so });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/sales-orders  { customer_id, order_type, material_id, qty, rate, order_date? }
  // Creates a single-line-item SO (its own so_no). For a multi-material SO,
  // use POST /api/sales-orders/bulk instead.
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

  // POST /api/sales-orders/bulk
  // { customer_id, order_type, order_date?, plant_id?, items: [{ material_id, qty, rate }, ...] }
  // Creates one SO number shared across every line item — this is how a
  // customer can order multiple materials under a single Sales Order.
  bulkCreate: async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
      const { customer_id, order_type, order_date, plant_id, items } = req.body;

      if (!customer_id || !order_type) throw createError(400, "customer_id and order_type are required");
      if (!["fg", "by_product"].includes(order_type)) throw createError(400, "order_type must be 'fg' or 'by_product'");
      if (!Array.isArray(items) || items.length === 0) {
        throw createError(400, "items must be a non-empty array of { material_id, qty, rate }");
      }

      const customer = await Customer.findOne({ where: { id: customer_id, is_deleted: false } });
      if (!customer) throw createError(400, "Invalid customer_id");

      for (const item of items) {
        if (!item.material_id || !item.qty || !item.rate) {
          throw createError(400, "Every item needs material_id, qty and rate");
        }
        const material = await MaterialMaster.findOne({ where: { id: item.material_id, is_deleted: false } });
        if (!material) throw createError(400, `Invalid material_id: ${item.material_id}`);
      }

      // Reject exact duplicate materials within the same submission.
      const seen = new Set();
      for (const item of items) {
        if (seen.has(item.material_id)) throw createError(400, "Duplicate material in the same SO submission");
        seen.add(item.material_id);
      }

      const so_no = await generateSoNo();
      const resolvedPlantId = plant_id || (req.user ? req.user.plant_id : null);
      const resolvedOrderDate = order_date || new Date().toISOString().slice(0, 10);

      const created = [];
      for (const item of items) {
        const row = await SalesOrder.create(
          {
            so_no,
            customer_id,
            order_type,
            material_id: item.material_id,
            qty: item.qty,
            rate: item.rate,
            order_date: resolvedOrderDate,
            so_status: "confirmed",
            plant_id: resolvedPlantId,
            created_by: req.user ? req.user.id : null,
          },
          { transaction: t }
        );
        created.push(row);
      }

      await t.commit();

      const fullRows = await SalesOrder.findAll({
        where: { so_no, id: { [Op.in]: created.map((r) => r.id) } },
        include: detailIncludes,
      });

      res.status(201).json({
        success: true,
        msg: `Sales order ${so_no} created with ${items.length} line item(s)`,
        data: fullRows,
      });
    } catch (err) {
      if (!t.finished) await t.rollback();

      // Surface exactly which field(s) tripped a leftover DB-level
      // constraint, instead of letting Sequelize's generic error through.
      if (err.name === "SequelizeUniqueConstraintError") {
        const fields = err.fields ? Object.keys(err.fields).join(", ") : "unknown field(s)";
        return next(createError(
          500,
          `A database constraint still exists on: ${fields}. This is very likely a leftover unique index from ` +
          `before multi-item Sales Orders were supported. Run "SHOW INDEX FROM sales_order;" in MySQL Workbench, ` +
          `find the index covering [${fields}], and drop it with: ALTER TABLE sales_order DROP INDEX <index_name>;`
        ));
      }
      if (err.name === "SequelizeValidationError" && Array.isArray(err.errors)) {
        const detail = err.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
        return next(createError(400, `Validation failed — ${detail}`));
      }

      next(err);
    }
  },

  // POST /api/sales-orders/so/:so_no/items  { material_id, qty, rate }
  // Adds one more material line to an EXISTING SO — this is what "Edit SO"
  // uses to let you keep adding materials to the same so_no rather than
  // only ever being able to edit the one line item you happened to open.
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

  // PUT /api/sales-orders/so/:so_no/header  { customer_id?, order_type?, order_date? }
  // Edits the shared header fields across EVERY line item of this SO at
  // once (e.g. correcting the order date), as opposed to PUT /:id which
  // only ever touches one line's own material/qty/rate.
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

  // PUT /api/sales-orders/:id
  update: async (req, res, next) => {
    try {
      const so = await SalesOrder.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!so) throw createError(404, "Sales order not found");

      const { material_id, qty, rate, order_date, so_status, plant_id } = req.body;
      if (so_status && !["pending", "confirmed", "allocated", "dispatched", "closed", "cancelled"].includes(so_status)) {
        throw createError(400, "Invalid so_status");
      }

      if (material_id) {
        const dup = await SalesOrder.findOne({
          where: { so_no: so.so_no, material_id, id: { [Op.ne]: so.id } },
        });
        if (dup) throw createError(409, "This material is already on this Sales Order");

        const material = await MaterialMaster.findOne({ where: { id: material_id, is_deleted: false } });
        if (!material) throw createError(400, "Invalid material_id");
      }

      const updates = { material_id, qty, rate, order_date, so_status, plant_id };
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      updates.updated_by = req.user ? req.user.id : null;

      await so.update(updates);

      const updated = await SalesOrder.findByPk(so.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Sales order updated", data: updated });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/sales-orders/:id  (soft delete)
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