// const createError = require("http-errors");
// const { PurchaseOrder, Purchase } = require("../models/index");

const createError = require("http-errors");
const { Op } = require("sequelize");
const {
  PurchaseOrder, Purchase, Vendor, MaterialMaster, VarietyMaster,
  GateEntry, WeightSlip,
} = require("../models/index");

// PO creation, rate negotiation, final purchase (Module 4)
// Primary CRUD below manages PurchaseOrder (needed by Gate Entry's po_id link).
// `convertToPurchase` closes the loop once a gate entry has been weighed, turning
// a PO (or a direct/no-PO gate entry) into a final Purchase record.

const poIncludes = [
  { model: Vendor, as: "vendor", attributes: ["id", "vendor_code", "name"] },
  { model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name"] },
  { model: VarietyMaster, as: "variety", attributes: ["id", "variety_name"] },
];

module.exports = {
  // GET /api/purchase?search=&vendor_id=&material_id=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { search, vendor_id, material_id, plant_id, page = 1, limit = 20 } = req.query;

      const where = { is_deleted: false };
      if (vendor_id) where.vendor_id = vendor_id;
      if (material_id) where.material_id = material_id;
      if (plant_id) where.plant_id = plant_id;
      if (search) {
        where[Op.or] = [{ po_no: { [Op.like]: `%${search}%` } }, { do_no: { [Op.like]: `%${search}%` } }];
      }

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await PurchaseOrder.findAndCountAll({
        where,
        include: poIncludes,
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

  // GET /api/purchase/:id
  getById: async (req, res, next) => {
    try {
      const po = await PurchaseOrder.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: poIncludes,
      });
      if (!po) throw createError(404, "Purchase order not found");
      res.status(200).json({ success: true, data: po });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/purchase
  create: async (req, res, next) => {
    try {
      const {
        po_no, vendor_id, material_id, variety_id, qty, rate,
        po_date, validity, do_no, uploaded_by_vendor, plant_id,
      } = req.body;

      if (!po_no || !vendor_id || !material_id || !qty || !rate || !po_date) {
        throw createError(400, "po_no, vendor_id, material_id, qty, rate and po_date are required");
      }

      const [vendor, material] = await Promise.all([
        Vendor.findOne({ where: { id: vendor_id, is_deleted: false } }),
        MaterialMaster.findOne({ where: { id: material_id, is_deleted: false } }),
      ]);
      if (!vendor) throw createError(400, "Invalid vendor_id");
      if (!material) throw createError(400, "Invalid material_id");

      if (variety_id) {
        const variety = await VarietyMaster.findOne({ where: { id: variety_id, is_deleted: false } });
        if (!variety) throw createError(400, "Invalid variety_id");
      }

      const existing = await PurchaseOrder.findOne({ where: { po_no } });
      if (existing) throw createError(409, "A purchase order with this po_no already exists");

      const po = await PurchaseOrder.create({
        po_no, vendor_id, material_id, variety_id, qty, rate, po_date, validity, do_no,
        uploaded_by_vendor: uploaded_by_vendor ?? false,
        plant_id: plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      const created = await PurchaseOrder.findByPk(po.id, { include: poIncludes });
      res.status(201).json({ success: true, msg: "Purchase order created", data: created });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/purchase/:id
  update: async (req, res, next) => {
    try {
      const po = await PurchaseOrder.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!po) throw createError(404, "Purchase order not found");

      const {
        po_no, vendor_id, material_id, variety_id, qty, rate,
        po_date, validity, do_no, uploaded_by_vendor, plant_id,
      } = req.body;

      if (po_no) {
        const dup = await PurchaseOrder.findOne({ where: { po_no, id: { [Op.ne]: po.id } } });
        if (dup) throw createError(409, "Another purchase order already uses this po_no");
      }
      if (vendor_id) {
        const vendor = await Vendor.findOne({ where: { id: vendor_id, is_deleted: false } });
        if (!vendor) throw createError(400, "Invalid vendor_id");
      }
      if (material_id) {
        const material = await MaterialMaster.findOne({ where: { id: material_id, is_deleted: false } });
        if (!material) throw createError(400, "Invalid material_id");
      }
      if (variety_id) {
        const variety = await VarietyMaster.findOne({ where: { id: variety_id, is_deleted: false } });
        if (!variety) throw createError(400, "Invalid variety_id");
      }

      const updates = {
        po_no, vendor_id, material_id, variety_id, qty, rate,
        po_date, validity, do_no, uploaded_by_vendor, plant_id,
      };
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      updates.updated_by = req.user ? req.user.id : null;

      await po.update(updates);

      const updated = await PurchaseOrder.findByPk(po.id, { include: poIncludes });
      res.status(200).json({ success: true, msg: "Purchase order updated", data: updated });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/purchase/:id  (soft delete)
  delete: async (req, res, next) => {
    try {
      const po = await PurchaseOrder.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!po) throw createError(404, "Purchase order not found");

      await po.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Purchase order deleted" });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/purchase/convert  { gate_entry_id, weight_slip_id, po_id?, final_rate, purchase_date }
  // Finalizes a weighed gate entry into a Purchase record (final_qty derived from the weight slip's net weight).
  convertToPurchase: async (req, res, next) => {
    try {
      const { gate_entry_id, weight_slip_id, po_id, final_rate, purchase_date, plant_id } = req.body;

      if (!gate_entry_id || !weight_slip_id || !final_rate || !purchase_date) {
        throw createError(400, "gate_entry_id, weight_slip_id, final_rate and purchase_date are required");
      }

      const [gateEntry, weightSlip] = await Promise.all([
        GateEntry.findOne({ where: { id: gate_entry_id, is_deleted: false } }),
        WeightSlip.findOne({ where: { id: weight_slip_id, gate_entry_id, is_deleted: false } }),
      ]);
      if (!gateEntry) throw createError(400, "Invalid gate_entry_id");
      if (!weightSlip) throw createError(400, "Invalid weight_slip_id for this gate_entry_id");

      const existing = await Purchase.findOne({ where: { gate_entry_id, is_deleted: false } });
      if (existing) throw createError(409, "This gate entry has already been converted to a purchase");

      if (po_id) {
        const po = await PurchaseOrder.findOne({ where: { id: po_id, is_deleted: false } });
        if (!po) throw createError(400, "Invalid po_id");
      }

      const final_qty = weightSlip.net_weight;
      const amount = Number(final_qty) * Number(final_rate);

      const purchase = await Purchase.create({
        po_id: po_id || gateEntry.po_id || null,
        gate_entry_id,
        weight_slip_id,
        final_rate,
        final_qty,
        amount,
        purchase_date,
        plant_id: plant_id || gateEntry.plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      res.status(201).json({ success: true, msg: "Purchase finalized", data: purchase });
    } catch (err) {
      next(err);
    }
  },
};
