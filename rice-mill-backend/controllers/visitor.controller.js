const createError = require("http-errors");
const { Visitor, User } = require("../models/index");
const { generateGatePassNo } = require("../helpers/helperFunction");

const detailIncludes = [
  { model: User, as: "createdByUser", attributes: ["id", "username", "email"] },
];

module.exports = {
  // GET /api/visitors?status=checked_in|checked_out
  getAll: async (req, res, next) => {
    try {
      const { status } = req.query;
      const where = { is_deleted: false };
      if (status) where.status = status;

      const rows = await Visitor.findAll({
        where,
        include: detailIncludes,
        order: [["check_in_time", "DESC"]],
      });
      res.status(200).json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },

  getById: async (req, res, next) => {
    try {
      const row = await Visitor.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: detailIncludes,
      });
      if (!row) throw createError(404, "Visitor record not found");
      res.status(200).json({ success: true, data: row });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/visitors — issues a gate pass and checks the visitor in
  // immediately (check_in_time = now).
  create: async (req, res, next) => {
    try {
      const { visitor_name, purpose, no_of_persons, phone, to_meet, remarks, plant_id } = req.body;

      if (!visitor_name || !purpose) {
        throw createError(400, "visitor_name and purpose are required");
      }
      const personsCount = no_of_persons !== undefined ? Number(no_of_persons) : 1;
      if (!(personsCount > 0)) {
        throw createError(400, "no_of_persons must be greater than 0");
      }

      const gate_pass_no = await generateGatePassNo();

      const visitor = await Visitor.create({
        gate_pass_no,
        visitor_name,
        purpose,
        no_of_persons: personsCount,
        phone: phone || null,
        to_meet: to_meet || null,
        remarks: remarks || null,
        check_in_time: new Date(),
        status: "checked_in",
        plant_id: plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      const created = await Visitor.findByPk(visitor.id, { include: detailIncludes });
      res.status(201).json({
        success: true,
        msg: `Gate pass ${gate_pass_no} issued for ${visitor_name}`,
        data: created,
      });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/visitors/:id/checkout — closes the gate pass.
  checkOut: async (req, res, next) => {
    try {
      const visitor = await Visitor.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!visitor) throw createError(404, "Visitor record not found");
      if (visitor.status === "checked_out") {
        throw createError(400, "This visitor has already checked out");
      }

      await visitor.update({
        check_out_time: new Date(),
        status: "checked_out",
        updated_by: req.user ? req.user.id : null,
      });

      const updated = await Visitor.findByPk(visitor.id, { include: detailIncludes });
      res.status(200).json({
        success: true,
        msg: `${visitor.visitor_name} checked out`,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },

  delete: async (req, res, next) => {
    try {
      const visitor = await Visitor.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!visitor) throw createError(404, "Visitor record not found");

      await visitor.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Visitor record deleted" });
    } catch (err) {
      next(err);
    }
  },
};