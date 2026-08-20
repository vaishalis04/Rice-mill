const createError = require("http-errors");
const { Op } = require("sequelize");
const { MachineMaster, MachineLog, MachineMaintenance, ProductionBatch, User } = require("../models/index");
const { generateCode } = require("../helpers/helperFunction");

// Machine master, run logs, recovery %, maintenance (Modules 13 & 29)
// Fronts three related tables via `type` = "master" | "log" | "maintenance"
// (query param for GET/DELETE, body field for POST/PUT). MachineLog rows are
// normally written automatically by the production stage endpoints
// (see production.controller.js); "log" here is read-only.

const registry = {
  master: { model: MachineMaster, label: "Machine" },
  log: { model: MachineLog, label: "Machine log" },
  maintenance: { model: MachineMaintenance, label: "Maintenance record" },
};

const getEntry = (type) => {
  const entry = registry[type || "master"];
  if (!entry) throw createError(400, `type must be one of: ${Object.keys(registry).join(", ")}`);
  return entry;
};

const getIncludes = (type) => {
  if (type === "log") {
    return [
      { model: MachineMaster, as: "machine", attributes: ["id", "machine_code", "name", "type"] },
      { model: ProductionBatch, as: "batch", attributes: ["id", "batch_no"] },
      { model: User, as: "operator", attributes: ["id", "username", "email"] },
    ];
  }
  if (type === "maintenance") {
    return [{ model: MachineMaster, as: "machine", attributes: ["id", "machine_code", "name"] }];
  }
  return [];
};

module.exports = {
  // GET /api/machines?type=master|log|maintenance&search=&machine_id=&batch_id=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { type, search, machine_id, batch_id, plant_id, page = 1, limit = 20 } = req.query;
      const { model: Model } = getEntry(type);

      const where = { is_deleted: false };
      if (plant_id) where.plant_id = plant_id;
      if (type === "log" || type === "maintenance") {
        if (machine_id) where.machine_id = machine_id;
      }
      if (type === "log" && batch_id) where.batch_id = batch_id;
      if ((!type || type === "master") && search) {
        where[Op.or] = [{ machine_code: { [Op.like]: `%${search}%` } }, { name: { [Op.like]: `%${search}%` } }];
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

  // GET /api/machines/:id?type=master|log|maintenance
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

  // POST /api/machines  { type, ...fields }
  // type=master: { machine_code, name, machine_type, capacity_per_hr?, install_date? }
  // type=maintenance: { machine_id, maintenance_type, start_time?, end_time?, cost?, performed_by? }
  // (type=log is read-only — created by the production stage endpoints)
  create: async (req, res, next) => {
    try {
      const { type } = req.body;

      if (type === "log") throw createError(400, "Machine logs are created automatically by the production stage endpoints, not manually");

      if (!type || type === "master") {
        const { name, machine_type, capacity_per_hr, install_date, plant_id } = req.body;
        const machine_code = await generateCode(MachineMaster, "machine_code", "MCH");
        if (!name || !machine_type) throw createError(400, "name and machine_type are required");
        if (!["huller", "separator", "shiner", "color_sorter", "grader", "dryer", "other"].includes(machine_type)) {
          throw createError(400, "Invalid machine_type");
        }

        const dup = await MachineMaster.findOne({ where: { machine_code } });
        if (dup) throw createError(409, "A machine with this machine_code already exists");

        const machine = await MachineMaster.create({
          machine_code,
          name,
          type: machine_type,
          capacity_per_hr,
          install_date,
          plant_id: plant_id || (req.user ? req.user.plant_id : null),
          created_by: req.user ? req.user.id : null,
        });

        return res.status(201).json({ success: true, msg: "Machine created", data: machine });
      }

      // maintenance
      const { machine_id, maintenance_type, start_time, end_time, cost, performed_by, plant_id } = req.body;
      if (!machine_id || !maintenance_type) throw createError(400, "machine_id and maintenance_type are required");
      if (!["preventive", "breakdown"].includes(maintenance_type)) throw createError(400, "maintenance_type must be 'preventive' or 'breakdown'");

      const machine = await MachineMaster.findOne({ where: { id: machine_id, is_deleted: false } });
      if (!machine) throw createError(400, "Invalid machine_id");

      const record = await MachineMaintenance.create({
        machine_id,
        maintenance_type,
        start_time,
        end_time,
        cost,
        performed_by,
        plant_id: plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      res.status(201).json({ success: true, msg: "Maintenance record created", data: record });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/machines/:id  { type, ...fields }
  update: async (req, res, next) => {
    try {
      const { type } = req.body;
      if (type === "log") throw createError(400, "Machine logs cannot be edited manually");

      const { model: Model, label } = getEntry(type);
      const record = await Model.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!record) throw createError(404, `${label} not found`);

      if (!type || type === "master") {
        const { machine_code, name, machine_type, capacity_per_hr, install_date, plant_id } = req.body;
        if (machine_type && !["huller", "separator", "shiner", "color_sorter", "grader", "dryer", "other"].includes(machine_type)) {
          throw createError(400, "Invalid machine_type");
        }
        if (machine_code) {
          const dup = await MachineMaster.findOne({ where: { machine_code, id: { [Op.ne]: record.id } } });
          if (dup) throw createError(409, "Another machine already uses this machine_code");
        }
        const updates = { machine_code, name, type: machine_type, capacity_per_hr, install_date, plant_id };
        Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
        updates.updated_by = req.user ? req.user.id : null;
        await record.update(updates);
        return res.status(200).json({ success: true, msg: "Machine updated", data: record });
      }

      // maintenance
      const { maintenance_type, start_time, end_time, cost, performed_by, plant_id } = req.body;
      if (maintenance_type && !["preventive", "breakdown"].includes(maintenance_type)) {
        throw createError(400, "maintenance_type must be 'preventive' or 'breakdown'");
      }
      const updates = { maintenance_type, start_time, end_time, cost, performed_by, plant_id };
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      updates.updated_by = req.user ? req.user.id : null;
      await record.update(updates);
      res.status(200).json({ success: true, msg: "Maintenance record updated", data: record });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/machines/:id?type=master|maintenance  (soft delete; logs cannot be deleted this way)
  delete: async (req, res, next) => {
    try {
      const { type } = req.query;
      if (type === "log") throw createError(400, "Machine logs cannot be deleted manually");

      const { model: Model, label } = getEntry(type);
      const record = await Model.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!record) throw createError(404, `${label} not found`);

      await record.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: `${label} deleted` });
    } catch (err) {
      next(err);
    }
  },
};
