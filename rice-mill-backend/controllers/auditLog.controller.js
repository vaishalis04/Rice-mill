const createError = require("http-errors");
const { AuditLog } = require("../models/index");


module.exports = {
  getAll: async (req, res, next) => {
    try {
      // TODO: list auditLog with filters / pagination
      res.status(200).json({ success: true, data: [] });
    } catch (err) {
      next(err);
    }
  },

  getById: async (req, res, next) => {
    try {
      // TODO: fetch single auditLog by req.params.id
      res.status(200).json({ success: true, data: null });
    } catch (err) {
      next(err);
    }
  },

  create: async (req, res, next) => {
    try {
      // TODO: create auditLog from req.body
      res.status(201).json({ success: true, msg: "Created", data: null });
    } catch (err) {
      next(err);
    }
  },

  update: async (req, res, next) => {
    try {
      // TODO: update auditLog req.params.id with req.body
      res.status(200).json({ success: true, msg: "Updated", data: null });
    } catch (err) {
      next(err);
    }
  },

  delete: async (req, res, next) => {
    try {
      // TODO: soft-delete auditLog req.params.id (is_deleted = true)
      res.status(200).json({ success: true, msg: "Deleted" });
    } catch (err) {
      next(err);
    }
  },
};
