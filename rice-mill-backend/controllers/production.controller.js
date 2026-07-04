const createError = require("http-errors");
const { ProductionBatch } = require("../models/index");

// Batch creation, stage routing (Module 11)
// TODO: implement business logic for each handler below.
module.exports = {
  getAll: async (req, res, next) => {
    try {
      // TODO: list production with filters / pagination
      res.status(200).json({ success: true, data: [] });
    } catch (err) {
      next(err);
    }
  },

  getById: async (req, res, next) => {
    try {
      // TODO: fetch single production by req.params.id
      res.status(200).json({ success: true, data: null });
    } catch (err) {
      next(err);
    }
  },

  create: async (req, res, next) => {
    try {
      // TODO: create production from req.body
      res.status(201).json({ success: true, msg: "Created", data: null });
    } catch (err) {
      next(err);
    }
  },

  update: async (req, res, next) => {
    try {
      // TODO: update production req.params.id with req.body
      res.status(200).json({ success: true, msg: "Updated", data: null });
    } catch (err) {
      next(err);
    }
  },

  delete: async (req, res, next) => {
    try {
      // TODO: soft-delete production req.params.id (is_deleted = true)
      res.status(200).json({ success: true, msg: "Deleted" });
    } catch (err) {
      next(err);
    }
  },

  startBatch: async (req, res, next) => {
    try {
      // TODO: implement startBatch
      res.status(200).json({ success: true, msg: "startBatch not yet implemented" });
    } catch (err) {
      next(err);
    }
  },
};
