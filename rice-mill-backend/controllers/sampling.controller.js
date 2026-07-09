const createError = require("http-errors");
const { Op } = require("sequelize");
const { GateEntry, Sampling, User } = require("../models/index");

// Sample collection & chain-of-custody (Module 5)
// A sample can only be drawn once a vehicle has been checked in at the gate
// (gate_status = 'waiting_sampling'). Creating a sample moves the gate entry
// forward to 'sampling_done', ready for the lab.

const detailIncludes = [
  { model: GateEntry, as: "gateEntry", attributes: ["id", "token_no", "gate_status", "vendor_id", "material_id"] },
  { model: User, as: "collector", attributes: ["id", "username", "email"] },
];

module.exports = {
  // GET /api/sampling?gate_entry_id=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { gate_entry_id, page = 1, limit = 20 } = req.query;

      const where = { is_deleted: false };
      if (gate_entry_id) where.gate_entry_id = gate_entry_id;

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await Sampling.findAndCountAll({
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

  // GET /api/sampling/:id
  getById: async (req, res, next) => {
    try {
      const sample = await Sampling.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: detailIncludes,
      });
      if (!sample) throw createError(404, "Sampling record not found");
      res.status(200).json({ success: true, data: sample });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/sampling  { gate_entry_id, sample_code, collected_at?, sent_to_lab_at? }
  create: async (req, res, next) => {
    try {
      const { gate_entry_id, sample_code, collected_at, sent_to_lab_at, plant_id } = req.body;

      if (!gate_entry_id || !sample_code) {
        throw createError(400, "gate_entry_id and sample_code are required");
      }

      const gateEntry = await GateEntry.findOne({ where: { id: gate_entry_id, is_deleted: false } });
      if (!gateEntry) throw createError(400, "Invalid gate_entry_id");
      if (gateEntry.gate_status !== "waiting_sampling") {
        throw createError(400, `Cannot draw a sample for a gate entry with status '${gateEntry.gate_status}'; it must be 'waiting_sampling'`);
      }

      const existing = await Sampling.findOne({ where: { sample_code } });
      if (existing) throw createError(409, "A sampling record with this sample_code already exists");
      const sample = await Sampling.create({
        gate_entry_id,
        sample_code,
        collected_by: req.user ? req.user.id : 12,
        collected_at: collected_at || new Date(),
        sent_to_lab_at: sent_to_lab_at || null,
        plant_id: plant_id || gateEntry.plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      // Auto-advance the gate entry now that a sample has been collected.
      await gateEntry.update({ gate_status: "sampling_done", updated_by: req.user ? req.user.id : null });

      const created = await Sampling.findByPk(sample.id, { include: detailIncludes });
      res.status(201).json({ success: true, msg: "Sample collected; gate entry moved to sampling_done", data: created });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/sampling/:id
  update: async (req, res, next) => {
    try {
      const sample = await Sampling.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!sample) throw createError(404, "Sampling record not found");

      const { sample_code, collected_at, sent_to_lab_at, plant_id } = req.body;

      if (sample_code) {
        const dup = await Sampling.findOne({ where: { sample_code, id: { [Op.ne]: sample.id } } });
        if (dup) throw createError(409, "Another sampling record already uses this sample_code");
      }

      const updates = { sample_code, collected_at, sent_to_lab_at, plant_id };
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      updates.updated_by = req.user ? req.user.id : null;

      await sample.update(updates);

      const updated = await Sampling.findByPk(sample.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Sampling record updated", data: updated });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/sampling/:id  (soft delete)
  delete: async (req, res, next) => {
    try {
      const sample = await Sampling.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!sample) throw createError(404, "Sampling record not found");

      await sample.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Sampling record deleted" });
    } catch (err) {
      next(err);
    }
  },
};
