const createError = require("http-errors");
const { Dryer } = require("../models/index");

// Drying cycles, moisture recheck (Module 12)
// TODO: implement business logic for each handler below.
module.exports = {
  getAll: async (req, res, next) => {
    try {
      // TODO: list dryer with filters / pagination
      res.status(200).json({ success: true, data: [] });
    } catch (err) {
      next(err);
    }
  },

  getById: async (req, res, next) => {
    try {
      // TODO: fetch single dryer by req.params.id
      res.status(200).json({ success: true, data: null });
    } catch (err) {
      next(err);
    }
  },

  create: async (req, res, next) => {
    try {
      // TODO: create dryer from req.body
      res.status(201).json({ success: true, msg: "Created", data: null });
    } catch (err) {
      next(err);
    }
  },

  update: async (req, res, next) => {
    try {
      // TODO: update dryer req.params.id with req.body
      res.status(200).json({ success: true, msg: "Updated", data: null });
    } catch (err) {
      next(err);
    }
  },

  delete: async (req, res, next) => {
    try {
      // TODO: soft-delete dryer req.params.id (is_deleted = true)
      res.status(200).json({ success: true, msg: "Deleted" });
    } catch (err) {
      next(err);
    }
  },
};
