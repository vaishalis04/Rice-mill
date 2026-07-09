const createError = require("http-errors");
const { Op } = require("sequelize");
const {
  GateEntry,
  Vehicle,
  Driver,
  Vendor,
  PurchaseOrder,
  MaterialMaster,
  PlantMaster,
} = require("../models/index");
const { generateTokenNo } = require("../helpers/helperFunction");

// Gate entry/exit, token & queue, driver photo capture (Module 1)

const detailIncludes = [
  { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no", "type", "capacity"] },
  { model: Driver, as: "driver", attributes: ["id", "name", "mobile", "license_no", "photo_url"] },
  { model: Vendor, as: "vendor", attributes: ["id", "vendor_code", "name", "vendor_type"] },
  { model: PurchaseOrder, as: "purchaseOrder", attributes: ["id", "po_no", "qty", "rate"] },
  { model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name", "category"] },
  { model: PlantMaster, as: "plant", attributes: ["id", "plant_code", "name"] },
];

// Shared existence/validity checks for the entities a gate entry references.
const validateReferences = async ({ vehicle_id, driver_id, vendor_id, material_id, po_id }) => {
  const [vehicle, driver, vendor, material] = await Promise.all([
    Vehicle.findOne({ where: { id: vehicle_id, is_deleted: false } }),
    Driver.findOne({ where: { id: driver_id, is_deleted: false } }),
    Vendor.findOne({ where: { id: vendor_id, is_deleted: false } }),
    MaterialMaster.findOne({ where: { id: material_id, is_deleted: false } }),
  ]);

  if (!vehicle) throw createError(400, "Invalid vehicle_id");
  if (!driver) throw createError(400, "Invalid driver_id");
  if (!vendor) throw createError(400, "Invalid vendor_id");
  if (!material) throw createError(400, "Invalid material_id");

  if (po_id) {
    const po = await PurchaseOrder.findOne({ where: { id: po_id, is_deleted: false } });
    if (!po) throw createError(400, "Invalid po_id");
    if (Number(po.vendor_id) !== Number(vendor_id)) {
      throw createError(400, "po_id does not belong to the given vendor_id");
    }
  }
};

module.exports = {
  // GET /api/gate?status=&vendor_id=&vehicle_id=&plant_id=&from=&to=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { status, vendor_id, vehicle_id, material_id, plant_id, from, to, page = 1, limit = 20 } = req.query;

      const where = { is_deleted: false };
      if (status) where.gate_status = status;
      if (vendor_id) where.vendor_id = vendor_id;
      if (vehicle_id) where.vehicle_id = vehicle_id;
      if (material_id) where.material_id = material_id;
      if (plant_id) where.plant_id = plant_id;
      if (from || to) {
        where.entry_time = {};
        if (from) where.entry_time[Op.gte] = new Date(from);
        if (to) where.entry_time[Op.lte] = new Date(to);
      }

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await GateEntry.findAndCountAll({
        where,
        include: detailIncludes,
        order: [["entry_time", "DESC"]],
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

  // GET /api/gate/:id
  getById: async (req, res, next) => {
    try {
      const entry = await GateEntry.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: detailIncludes,
      });
      if (!entry) throw createError(404, "Gate entry not found");
      res.status(200).json({ success: true, data: entry });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/gate  (manual/admin creation - does not auto-generate a token; use /generatetoken for the gate workflow)
  create: async (req, res, next) => {
    try {
      const {
        vehicle_id, driver_id, vendor_id, po_id, material_id,
        challan_no, expected_qty, driver_photo_url, plant_id,
      } = req.body;

      if (!vehicle_id || !driver_id || !vendor_id || !material_id) {
        throw createError(400, "vehicle_id, driver_id, vendor_id and material_id are required");
      }

      await validateReferences({ vehicle_id, driver_id, vendor_id, material_id, po_id });

      const token_no = await generateTokenNo();

      const entry = await GateEntry.create({
        token_no,
        vehicle_id,
        driver_id,
        vendor_id,
        po_id: po_id || null,
        material_id,
        challan_no,
        expected_qty,
        driver_photo_url,
        entry_time: new Date(),
        gate_status: "waiting_token",
        plant_id: plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      const created = await GateEntry.findByPk(entry.id, { include: detailIncludes });
      res.status(201).json({ success: true, msg: "Gate entry created", data: created });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/gate/:id
  update: async (req, res, next) => {
    try {
      const entry = await GateEntry.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!entry) throw createError(404, "Gate entry not found");

      const {
        vehicle_id, driver_id, vendor_id, po_id, material_id,
        challan_no, expected_qty, driver_photo_url, plant_id, gate_status,
      } = req.body;

      await validateReferences({
        vehicle_id: vehicle_id || entry.vehicle_id,
        driver_id: driver_id || entry.driver_id,
        vendor_id: vendor_id || entry.vendor_id,
        material_id: material_id || entry.material_id,
        po_id: po_id !== undefined ? po_id : entry.po_id,
      });

      const updates = {
        vehicle_id, driver_id, vendor_id, po_id, material_id,
        challan_no, expected_qty, driver_photo_url, plant_id, gate_status,
      };
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      updates.updated_by = req.user ? req.user.id : null;

      await entry.update(updates);

      const updated = await GateEntry.findByPk(entry.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Gate entry updated", data: updated });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/gate/:id  (soft delete)
  delete: async (req, res, next) => {
    try {
      const entry = await GateEntry.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!entry) throw createError(404, "Gate entry not found");

      await entry.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Gate entry deleted" });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/gate/checkin  { id }  -- move a token'd vehicle forward into the yard for sampling
  checkIn: async (req, res, next) => {
    try {
      const { id } = req.body;
      if (!id) throw createError(400, "id is required");

      const entry = await GateEntry.findOne({ where: { id, is_deleted: false } });
      if (!entry) throw createError(404, "Gate entry not found");

      if (entry.gate_status !== "waiting_token") {
        throw createError(400, `Cannot check in a gate entry with status '${entry.gate_status}'`);
      }

      await entry.update({ gate_status: "waiting_sampling", updated_by: req.user ? req.user.id : null });

      const updated = await GateEntry.findByPk(entry.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Vehicle checked in", data: updated });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/gate/checkout  { id }  -- vehicle leaves the plant
  checkOut: async (req, res, next) => {
    try {
      const { id } = req.body;
      if (!id) throw createError(400, "id is required");

      const entry = await GateEntry.findOne({ where: { id, is_deleted: false } });
      if (!entry) throw createError(404, "Gate entry not found");

      if (entry.gate_status === "exited") {
        throw createError(400, "This gate entry has already exited");
      }
      if (entry.gate_status === "waiting_token") {
        throw createError(400, "Vehicle has not been checked in yet; cannot check out");
      }

      await entry.update({
        gate_status: "exited",
        exit_time: new Date(),
        updated_by: req.user ? req.user.id : null,
      });

      const updated = await GateEntry.findByPk(entry.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Vehicle checked out", data: updated });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/gate/generatetoken  -- primary gate-keeper workflow: validates entities, issues a
  // sequential token number and opens a new gate entry record with status 'waiting_token'.
  generateToken: async (req, res, next) => {
    try {
      const {
        vehicle_id, driver_id, vendor_id, po_id, material_id,
        challan_no, expected_qty, driver_photo_url, plant_id,
      } = req.body;

      if (!vehicle_id || !driver_id || !vendor_id || !material_id) {
        throw createError(400, "vehicle_id, driver_id, vendor_id and material_id are required");
      }

      await validateReferences({ vehicle_id, driver_id, vendor_id, material_id, po_id });

      const token_no = await generateTokenNo();

      const entry = await GateEntry.create({
        token_no,
        vehicle_id,
        driver_id,
        vendor_id,
        po_id: po_id || null,
        material_id,
        challan_no,
        expected_qty,
        driver_photo_url,
        entry_time: new Date(),
        gate_status: "waiting_token",
        plant_id: plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      const created = await GateEntry.findByPk(entry.id, { include: detailIncludes });
      res.status(201).json({ success: true, msg: "Token generated", data: created });
    } catch (err) {
      next(err);
    }
  },
};
