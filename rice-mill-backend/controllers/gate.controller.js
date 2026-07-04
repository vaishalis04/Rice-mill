const createError = require("http-errors");
const { GateEntry } = require("../models/index");

// Gate entry/exit, token & queue, driver photo capture (Module 1)
// TODO: implement business logic for each handler below.
module.exports = {
  getAll: async (req, res, next) => {
    try {
      // TODO: list gate with filters / pagination
      res.status(200).json({ success: true, data: [] });
    } catch (err) {
      next(err);
    }
  },

  getById: async (req, res, next) => {
    try {
      // TODO: fetch single gate by req.params.id
      res.status(200).json({ success: true, data: null });
    } catch (err) {
      next(err);
    }
  },

  create: async (req, res, next) => {
    try {
      // TODO: create gate from req.body
      res.status(201).json({ success: true, msg: "Created", data: null });
    } catch (err) {
      next(err);
    }
  },

  update: async (req, res, next) => {
    try {
      // TODO: update gate req.params.id with req.body
      res.status(200).json({ success: true, msg: "Updated", data: null });
    } catch (err) {
      next(err);
    }
  },

  delete: async (req, res, next) => {
    try {
      // TODO: soft-delete gate req.params.id (is_deleted = true)
      res.status(200).json({ success: true, msg: "Deleted" });
    } catch (err) {
      next(err);
    }
  },

  checkIn: async (req, res, next) => {
    try {
      // TODO: implement checkIn
      res.status(200).json({ success: true, msg: "checkIn not yet implemented" });
    } catch (err) {
      next(err);
    }
  },

  checkOut: async (req, res, next) => {
    try {
      // TODO: implement checkOut
      res.status(200).json({ success: true, msg: "checkOut not yet implemented" });
    } catch (err) {
      next(err);
    }
  },

  generateToken: async (req, res, next) => {
    try {
      // TODO: implement generateToken
      res.status(200).json({ success: true, msg: "generateToken not yet implemented" });
    } catch (err) {
      next(err);
    }
  },
};
