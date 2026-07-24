const createError = require("http-errors");
const { SalesOrder, Customer, MaterialMaster } = require("../models/index");
const { generateSoNo } = require("../helpers/helperFunction");

// Order booking, allocation (Module 18)
// Creating a sales order books it immediately as 'confirmed' — there's no
// separate draft/approval step in this simplified flow. Allocation happens
// when a Dispatch is created against it (see dispatch.controller.js).

const detailIncludes = [
  { model: Customer, as: "customer", attributes: ["id", "customer_code", "name", "customer_type"] },
  { model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name"] },
];

module.exports = {
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

  // PUT /api/sales-orders/:id
  update: async (req, res, next) => {
    try {
      const so = await SalesOrder.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!so) throw createError(404, "Sales order not found");

      const { qty, rate, order_date, so_status, plant_id } = req.body;
      if (so_status && !["pending", "confirmed", "allocated", "dispatched", "closed", "cancelled"].includes(so_status)) {
        throw createError(400, "Invalid so_status");
      }

      const updates = { qty, rate, order_date, so_status, plant_id };
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
