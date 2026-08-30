const createError = require("http-errors");
const { Op } = require("sequelize");
const { Customer, SalesOrder, Dispatch, MaterialMaster, Vehicle, Driver } = require("../models/index");
const { generateCustomerCode } = require("../helpers/helperFunction");

// Customer master incl. by-product buyers
module.exports = {
  // GET /api/customers?search=&customer_type=&plant_id=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { search, customer_type, plant_id, page = 1, limit = 20 } = req.query;

      const where = { is_deleted: false };
      if (customer_type) where.customer_type = customer_type;
      if (plant_id) where.plant_id = plant_id;
      if (search) {
        where[Op.or] = [
          { name: { [Op.like]: `%${search}%` } },
          { customer_code: { [Op.like]: `%${search}%` } },
          { gstin: { [Op.like]: `%${search}%` } },
        ];
      }

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await Customer.findAndCountAll({
        where,
        order: [["created_at", "DESC"]],
        limit: Number(limit),
        offset,
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

  // GET /api/customers/:id/history
  // One-call "customer profile" — full contact/address details plus every
  // order they've placed and every dispatch fulfilling those orders, so
  // Dispatch and Admin can both show "who we sold to, how much, and when"
  // without stitching together multiple screens.
  getHistory: async (req, res, next) => {
    try {
      const customer = await Customer.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!customer) throw createError(404, "Customer not found");

      const salesOrders = await SalesOrder.findAll({
        where: { customer_id: customer.id, is_deleted: false },
        include: [{ model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name"] }],
        order: [["order_date", "DESC"]],
      });

      const dispatches = await Dispatch.findAll({
        where: { is_deleted: false },
        include: [
          {
            model: SalesOrder,
            as: "salesOrder",
            where: { customer_id: customer.id },
            attributes: ["id", "so_no"],
          },
          { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
          { model: Driver, as: "driver", attributes: ["id", "name"] },
        ],
        order: [["created_at", "DESC"]],
      });

      const totalOrderedQty = salesOrders.reduce((sum, so) => sum + Number(so.qty || 0), 0);
      const totalDispatchedQty = dispatches.reduce((sum, d) => sum + Number(d.dispatch_weight || 0), 0);

      res.status(200).json({
        success: true,
        data: {
          customer,
          salesOrders,
          dispatches,
          summary: {
            orderCount: salesOrders.length,
            dispatchCount: dispatches.length,
            totalOrderedQty,
            totalDispatchedQty,
          },
        },
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/customers/:id
  getById: async (req, res, next) => {
    try {
      const customer = await Customer.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!customer) throw createError(404, "Customer not found");
      res.status(200).json({ success: true, data: customer });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/customers
  create: async (req, res, next) => {
    try {
      const { name, gstin, address, credit_limit, customer_type, plant_id } = req.body;

      if (!name) throw createError(400, "name is required");
      if (gstin && gstin.length !== 15) throw createError(400, "gstin must be 15 characters");
      if (customer_type && !["fg", "by_product"].includes(customer_type)) {
        throw createError(400, "customer_type must be 'fg' or 'by_product'");
      }

      const normalizedCreditLimit =
        credit_limit === "" || credit_limit === null || credit_limit === undefined
          ? 0
          : Number(credit_limit);

      // customer_code is auto-generated (CUST0001, CUST0002, ...) unless the
      // caller explicitly supplies one — kept optional-override for admin
      // tooling/imports, but the UI no longer asks for it.
      const customer_code = await generateCustomerCode();

      if (gstin) {
        const existing = await Customer.findOne({ where: { gstin } });
        if (existing) throw createError(409, "A customer with this gstin already exists");
      }

      const customer = await Customer.create({
        customer_code,
        name,
        gstin: gstin || null,
        address,
        credit_limit: normalizedCreditLimit,
        customer_type: customer_type || "fg",
        plant_id: plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      res.status(201).json({ success: true, msg: "Customer created", data: customer });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/customers/:id
  update: async (req, res, next) => {
    try {
      const customer = await Customer.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!customer) throw createError(404, "Customer not found");

      const { customer_code, name, gstin, address, credit_limit, customer_type, plant_id } = req.body;

      if (gstin && gstin.length !== 15) throw createError(400, "gstin must be 15 characters");
      if (customer_type && !["fg", "by_product"].includes(customer_type)) {
        throw createError(400, "customer_type must be 'fg' or 'by_product'");
      }

      const normalizedCreditLimit =
        credit_limit === "" || credit_limit === null || credit_limit === undefined
          ? 0
          : Number(credit_limit);

      if (customer_code || gstin) {
        const dup = await Customer.findOne({
          where: {
            id: { [Op.ne]: customer.id },
            [Op.or]: [...(customer_code ? [{ customer_code }] : []), ...(gstin ? [{ gstin }] : [])],
          },
        });
        if (dup) throw createError(409, "Another customer already uses this customer_code or gstin");
      }

      const updates = {
        customer_code,
        name,
        gstin: gstin === "" ? null : gstin,
        address,
        credit_limit: normalizedCreditLimit,
        customer_type,
        plant_id,
      };
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      updates.updated_by = req.user ? req.user.id : null;

      await customer.update(updates);
      res.status(200).json({ success: true, msg: "Customer updated", data: customer });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/customers/:id  (soft delete)
  delete: async (req, res, next) => {
    try {
      const customer = await Customer.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!customer) throw createError(404, "Customer not found");

      await customer.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Customer deleted" });
    } catch (err) {
      next(err);
    }
  },
};