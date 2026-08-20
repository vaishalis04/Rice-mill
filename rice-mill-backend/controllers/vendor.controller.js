const createError = require("http-errors");
const { Op } = require("sequelize");
const { Vendor } = require("../models/index");
const { generateVendorCode } = require("../helpers/helperFunction");

// Vendor master, rating, ledger (Module 3)
module.exports = {
  // GET /api/vendor?search=&vendor_type=&plant_id=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { search, vendor_type, plant_id, page = 1, limit = 20 } = req.query;

      const where = { is_deleted: false };
      if (vendor_type) where.vendor_type = vendor_type;
      if (plant_id) where.plant_id = plant_id;
      if (search) {
        where[Op.or] = [
          { name: { [Op.like]: `%${search}%` } },
          { vendor_code: { [Op.like]: `%${search}%` } },
          { gstin: { [Op.like]: `%${search}%` } },
        ];
      }

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await Vendor.findAndCountAll({
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

  // GET /api/vendor/:id
  getById: async (req, res, next) => {
    try {
      const vendor = await Vendor.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!vendor) throw createError(404, "Vendor not found");
      res.status(200).json({ success: true, data: vendor });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/vendor
  create: async (req, res, next) => {
    try {
      const {
        name, gstin, address, bank_details,
        rating, credit_terms, vendor_type, plant_id,
      } = req.body;

      if (!name) throw createError(400, "name is required");
      if (gstin && gstin.length !== 15) throw createError(400, "gstin must be 15 characters");
      if (vendor_type && !["supplier", "by_product_buyer"].includes(vendor_type)) {
        throw createError(400, "vendor_type must be 'supplier' or 'by_product_buyer'");
      }

      // vendor_code is auto-generated (VEND0001, VEND0002, ...) unless the
      // caller explicitly supplies one.
      const vendor_code = await generateVendorCode();

      if (gstin) {
        const existing = await Vendor.findOne({ where: { gstin } });
        if (existing) throw createError(409, "A vendor with this gstin already exists");
      }

      const vendor = await Vendor.create({
        vendor_code,
        name,
        gstin: gstin || null,
        address,
        bank_details,
        rating: rating ?? 0,
        credit_terms,
        vendor_type: vendor_type || "supplier",
        plant_id: plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      res.status(201).json({ success: true, msg: "Vendor created", data: vendor });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/vendor/:id
  update: async (req, res, next) => {
    try {
      const vendor = await Vendor.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!vendor) throw createError(404, "Vendor not found");

      const {
        vendor_code, name, gstin, address, bank_details,
        rating, credit_terms, vendor_type, plant_id,
      } = req.body;

      if (gstin && gstin.length !== 15) throw createError(400, "gstin must be 15 characters");
      if (vendor_type && !["supplier", "by_product_buyer"].includes(vendor_type)) {
        throw createError(400, "vendor_type must be 'supplier' or 'by_product_buyer'");
      }

      if (vendor_code || gstin) {
        const dup = await Vendor.findOne({
          where: {
            id: { [Op.ne]: vendor.id },
            [Op.or]: [...(vendor_code ? [{ vendor_code }] : []), ...(gstin ? [{ gstin }] : [])],
          },
        });
        if (dup) throw createError(409, "Another vendor already uses this vendor_code or gstin");
      }

      const updates = { vendor_code, name, gstin: gstin === "" ? null : gstin, address, bank_details, rating, credit_terms, vendor_type, plant_id };
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      updates.updated_by = req.user ? req.user.id : null;

      await vendor.update(updates);
      res.status(200).json({ success: true, msg: "Vendor updated", data: vendor });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/vendor/:id  (soft delete)
  delete: async (req, res, next) => {
    try {
      const vendor = await Vendor.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!vendor) throw createError(404, "Vendor not found");

      await vendor.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Vendor deleted" });
    } catch (err) {
      next(err);
    }
  },
};