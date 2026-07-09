const createError = require("http-errors");
const { Op } = require("sequelize");
const { Vehicle, Driver, Vendor } = require("../models/index");

// Vehicle / driver master & history (Module 20)
// This single module manages two related masters (Vehicle, Driver) used together
// at the gate. Which one a request targets is chosen via `type` = "vehicle" | "driver"
// (query param for GET/DELETE, body field for POST/PUT). Defaults to "vehicle".

const getModel = (type) => {
  if (type === "driver") return Driver;
  if (type === "vehicle" || !type) return Vehicle;
  throw createError(400, "type must be 'vehicle' or 'driver'");
};

module.exports = {
  // GET /api/vehicledriver?type=vehicle|driver&search=&plant_id=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { type, search, plant_id, page = 1, limit = 20 } = req.query;
      const Model = getModel(type);

      const where = { is_deleted: false };
      if (plant_id) where.plant_id = plant_id;

      if (search) {
        where[Op.or] = Model === Vehicle
          ? [{ vehicle_no: { [Op.like]: `%${search}%` } }]
          : [
              { name: { [Op.like]: `%${search}%` } },
              { mobile: { [Op.like]: `%${search}%` } },
              { license_no: { [Op.like]: `%${search}%` } },
            ];
      }

      const offset = (Number(page) - 1) * Number(limit);
      const include = Model === Vehicle
        ? [{ model: Vendor, as: "ownerVendor", attributes: ["id", "vendor_code", "name"] }]
        : [];

      const { rows, count } = await Model.findAndCountAll({
        where,
        include,
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

  // GET /api/vehicledriver/:id?type=vehicle|driver
  getById: async (req, res, next) => {
    try {
      const { type } = req.query;
      const Model = getModel(type);
      const include = Model === Vehicle
        ? [{ model: Vendor, as: "ownerVendor", attributes: ["id", "vendor_code", "name"] }]
        : [];

      const record = await Model.findOne({ where: { id: req.params.id, is_deleted: false }, include });
      if (!record) throw createError(404, `${Model.name} not found`);
      res.status(200).json({ success: true, data: record });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/vehicledriver  { type, ...fields }
  create: async (req, res, next) => {
    try {
      const { type } = req.body;
      const Model = getModel(type);

      if (Model === Vehicle) {
        const { vehicle_no, vehicle_type, capacity, owner_vendor_id, plant_id } = req.body;
        if (!vehicle_no || !vehicle_type) throw createError(400, "vehicle_no and vehicle_type are required");
        if (!["truck", "tractor_trolley"].includes(vehicle_type)) {
          throw createError(400, "vehicle_type must be 'truck' or 'tractor_trolley'");
        }

        const existing = await Vehicle.findOne({ where: { vehicle_no } });
        if (existing) throw createError(409, "A vehicle with this vehicle_no already exists");

        if (owner_vendor_id) {
          const vendor = await Vendor.findOne({ where: { id: owner_vendor_id, is_deleted: false } });
          if (!vendor) throw createError(400, "Invalid owner_vendor_id");
        }

        const record = await Vehicle.create({
          vehicle_no,
          type: vehicle_type,
          capacity,
          owner_vendor_id: owner_vendor_id || null,
          plant_id: plant_id || (req.user ? req.user.plant_id : null),
          created_by: req.user ? req.user.id : null,
        });

        return res.status(201).json({ success: true, msg: "Vehicle created", data: record });
      }

      // Driver
      const { name, mobile, license_no, photo_url, plant_id } = req.body;
      if (!name || !mobile) throw createError(400, "name and mobile are required");

      const existing = await Driver.findOne({
        where: { [Op.or]: [{ mobile }, ...(license_no ? [{ license_no }] : [])] },
      });
      if (existing) throw createError(409, "A driver with this mobile or license_no already exists");

      const record = await Driver.create({
        name,
        mobile,
        license_no,
        photo_url,
        plant_id: plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      res.status(201).json({ success: true, msg: "Driver created", data: record });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/vehicledriver/:id  { type, ...fields }
  update: async (req, res, next) => {
    try {
      const { type } = req.body;
      const Model = getModel(type);

      const record = await Model.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!record) throw createError(404, `${Model.name} not found`);

      if (Model === Vehicle) {
        const { vehicle_no, vehicle_type, capacity, owner_vendor_id, plant_id } = req.body;

        if (vehicle_type && !["truck", "tractor_trolley"].includes(vehicle_type)) {
          throw createError(400, "vehicle_type must be 'truck' or 'tractor_trolley'");
        }
        if (vehicle_no) {
          const dup = await Vehicle.findOne({ where: { vehicle_no, id: { [Op.ne]: record.id } } });
          if (dup) throw createError(409, "Another vehicle already uses this vehicle_no");
        }
        if (owner_vendor_id) {
          const vendor = await Vendor.findOne({ where: { id: owner_vendor_id, is_deleted: false } });
          if (!vendor) throw createError(400, "Invalid owner_vendor_id");
        }

        const updates = { vehicle_no, type: vehicle_type, capacity, owner_vendor_id, plant_id };
        Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
        updates.updated_by = req.user ? req.user.id : null;

        await record.update(updates);
        return res.status(200).json({ success: true, msg: "Vehicle updated", data: record });
      }

      // Driver
      const { name, mobile, license_no, photo_url, plant_id } = req.body;
      if (mobile || license_no) {
        const dup = await Driver.findOne({
          where: {
            id: { [Op.ne]: record.id },
            [Op.or]: [...(mobile ? [{ mobile }] : []), ...(license_no ? [{ license_no }] : [])],
          },
        });
        if (dup) throw createError(409, "Another driver already uses this mobile or license_no");
      }

      const updates = { name, mobile, license_no, photo_url, plant_id };
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      updates.updated_by = req.user ? req.user.id : null;

      await record.update(updates);
      res.status(200).json({ success: true, msg: "Driver updated", data: record });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/vehicledriver/:id?type=vehicle|driver  (soft delete)
  delete: async (req, res, next) => {
    try {
      const { type } = req.query;
      const Model = getModel(type);

      const record = await Model.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!record) throw createError(404, `${Model.name} not found`);

      await record.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: `${Model.name} deleted` });
    } catch (err) {
      next(err);
    }
  },
};
