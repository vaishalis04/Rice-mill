const createError = require("http-errors");
const { User, Role, Permission, RolePermission } = require("../models/index");

// User, role & permission management (Module 26)
// TODO: implement business logic for each handler below.
module.exports = {
  getAll: async (req, res, next) => {
    try {
      // TODO: list user with filters / pagination
      res.status(200).json({ success: true, data: [] });
    } catch (err) {
      next(err);
    }
  },

  getById: async (req, res, next) => {
    try {
      // TODO: fetch single user by req.params.id
      res.status(200).json({ success: true, data: null });
    } catch (err) {
      next(err);
    }
  },

  create: async (req, res, next) => {
    try {
      // TODO: create user from req.body
      res.status(201).json({ success: true, msg: "Created", data: null });
    } catch (err) {
      next(err);
    }
  },

  update: async (req, res, next) => {
    try {
      // TODO: update user req.params.id with req.body
      res.status(200).json({ success: true, msg: "Updated", data: null });
    } catch (err) {
      next(err);
    }
  },

  delete: async (req, res, next) => {
    try {
      // TODO: soft-delete user req.params.id (is_deleted = true)
      res.status(200).json({ success: true, msg: "Deleted" });
    } catch (err) {
      next(err);
    }
  },

  assignRole: async (req, res, next) => {
    try {
      // TODO: implement assignRole
      res.status(200).json({ success: true, msg: "assignRole not yet implemented" });
    } catch (err) {
      next(err);
    }
  },
};
