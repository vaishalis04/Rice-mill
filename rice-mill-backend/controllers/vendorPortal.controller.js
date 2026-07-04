const createError = require("http-errors");
const { PurchaseOrder } = require("../models/index");

// Vendor self-service portal: PO/DO upload (Module 2)
// TODO: implement business logic for each handler below.
module.exports = {
  getAll: async (req, res, next) => {
    try {
      // TODO: list vendorPortal with filters / pagination
      res.status(200).json({ success: true, data: [] });
    } catch (err) {
      next(err);
    }
  },

  getById: async (req, res, next) => {
    try {
      // TODO: fetch single vendorPortal by req.params.id
      res.status(200).json({ success: true, data: null });
    } catch (err) {
      next(err);
    }
  },

  create: async (req, res, next) => {
    try {
      // TODO: create vendorPortal from req.body
      res.status(201).json({ success: true, msg: "Created", data: null });
    } catch (err) {
      next(err);
    }
  },

  update: async (req, res, next) => {
    try {
      // TODO: update vendorPortal req.params.id with req.body
      res.status(200).json({ success: true, msg: "Updated", data: null });
    } catch (err) {
      next(err);
    }
  },

  delete: async (req, res, next) => {
    try {
      // TODO: soft-delete vendorPortal req.params.id (is_deleted = true)
      res.status(200).json({ success: true, msg: "Deleted" });
    } catch (err) {
      next(err);
    }
  },

  uploadPO: async (req, res, next) => {
    try {
      // TODO: implement uploadPO
      res.status(200).json({ success: true, msg: "uploadPO not yet implemented" });
    } catch (err) {
      next(err);
    }
  },

  uploadDO: async (req, res, next) => {
    try {
      // TODO: implement uploadDO
      res.status(200).json({ success: true, msg: "uploadDO not yet implemented" });
    } catch (err) {
      next(err);
    }
  },
};
