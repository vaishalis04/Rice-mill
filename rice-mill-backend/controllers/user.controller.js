const createError = require("http-errors");
const bcrypt = require("bcrypt");

const {
  User,
  Role,
  Permission,
  RolePermission,
} = require("../models");

module.exports = {
  // ===========================
  // Get All Users
  // ===========================
  getAll: async (req, res, next) => {
    try {
      const users = await User.findAll({
        where: {
          is_deleted: false,
        },
        include: [
          {
            model: Role,
            attributes: ["id", "role_name"],
          },
        ],
        attributes: {
          exclude: ["password_hash"],
        },
        order: [["id", "DESC"]],
      });

      res.status(200).json({
        success: true,
        count: users.length,
        data: users,
      });
    } catch (err) {
      next(err);
    }
  },

  // ===========================
  // Get User By Id
  // ===========================
  getById: async (req, res, next) => {
    try {
      const user = await User.findOne({
        where: {
          id: req.params.id,
          is_deleted: false,
        },
        include: [
          {
            model: Role,
            attributes: ["id", "role_name"],
          },
        ],
        attributes: {
          exclude: ["password_hash"],
        },
      });

      if (!user) {
        throw createError(404, "User not found");
      }

      res.status(200).json({
        success: true,
        data: user,
      });
    } catch (err) {
      next(err);
    }
  },

  // ===========================
  // Create User
  // ===========================
  create: async (req, res, next) => {
    try {
      const {
        username,
        email,
        phone,
        password,
        role_id,
        employee_code,
        plant_id,
      } = req.body;

      const role = await Role.findByPk(role_id);

      if (!role) {
        throw createError(404, "Role not found");
      }

      const existingUser = await User.findOne({
        where: {
          email,
          is_deleted: false,
        },
      });

      if (existingUser) {
        throw createError(409, "Email already exists");
      }

      const hash = await bcrypt.hash(password, 10);

      const user = await User.create({
        username,
        email,
        phone,
        password_hash: hash,
        role_id,
        employee_code,
        plant_id,
        created_by: req.user?.id || null,
      });

      res.status(201).json({
        success: true,
        msg: "User created successfully",
        data: {
          id: user.id,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  // ===========================
  // Update User
  // ===========================
  update: async (req, res, next) => {
    try {
      const id = req.params.id;

      const user = await User.findOne({
        where: {
          id,
          is_deleted: false,
        },
      });

      if (!user) {
        throw createError(404, "User not found");
      }

      const updateData = { ...req.body };

      if (req.body.password) {
        updateData.password_hash = await bcrypt.hash(req.body.password, 10);
        delete updateData.password;
      }

      updateData.updated_by = req.user?.id || null;

      await user.update(updateData);

      res.status(200).json({
        success: true,
        msg: "User updated successfully",
        data: user,
      });
    } catch (err) {
      next(err);
    }
  },

  // ===========================
  // Soft Delete User
  // ===========================
  delete: async (req, res, next) => {
    try {
      const user = await User.findOne({
        where: {
          id: req.params.id,
          is_deleted: false,
        },
      });

      if (!user) {
        throw createError(404, "User not found");
      }

      await user.update({
        is_deleted: true,
        updated_by: req.user?.id || null,
      });

      res.status(200).json({
        success: true,
        msg: "User deleted successfully",
      });
    } catch (err) {
      next(err);
    }
  },

  // ===========================
  // Assign Role
  // ===========================
  assignRole: async (req, res, next) => {
    try {
      const { user_id, role_id } = req.body;

      const user = await User.findOne({
        where: {
          id: user_id,
          is_deleted: false,
        },
      });

      if (!user) {
        throw createError(404, "User not found");
      }

      const role = await Role.findOne({
        where: {
          id: role_id,
          is_deleted: false,
        },
      });

      if (!role) {
        throw createError(404, "Role not found");
      }

      await user.update({
        role_id,
        updated_by: req.user?.id || null,
      });

      res.status(200).json({
        success: true,
        msg: "Role assigned successfully",
      });
    } catch (err) {
      next(err);
    }
  },
};