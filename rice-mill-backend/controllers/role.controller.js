const createError = require("http-errors");
const { Op } = require("sequelize");
const { Role, Permission, RolePermission, User } = require("../models/index");

// Admin-managed custom roles + permissions.
//
// Permissions are granted per PAGE (e.g. "warehouse.unloading",
// "admin.advisory_trucks"), not per CRUD action — see permission.model.js.
// The frontend's page catalogs (RolesPage.jsx, and each dashboard's
// TAB_CATALOG) are the source of truth for which module/page combinations
// actually mean something; this controller just stores whatever
// module/action pair it's given.
//
// IMPORTANT — see auth.middleware.js's requirePermission(): most existing
// routes still gate access with authorize("admin","warehouse",...), a
// hardcoded role-NAME whitelist. A role created here stores and shows up
// correctly everywhere, and a granted page now actually shows/hides that
// tab on the matching dashboard, but a page's underlying API routes won't
// themselves enforce this until migrated to requirePermission(...) too —
// do that deliberately, one route at a time, once you're ready.

module.exports = {
  // ---------------- Permissions catalog ----------------

  // GET /api/role-management/permissions
  getPermissions: async (req, res, next) => {
    try {
      const permissions = await Permission.findAll({
        where: { is_deleted: false },
        order: [["module", "ASC"], ["action", "ASC"]],
      });
      res.status(200).json({ success: true, data: permissions });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/role-management/permissions  { module, action }
  // "action" is a page key (e.g. "unloading") — code is generated as
  // "<module>.<action>" (e.g. "warehouse.unloading"), which is what a
  // dashboard's TAB_CATALOG matches against to show/hide that tab, and
  // what requirePermission() checks on any migrated route.
  createPermission: async (req, res, next) => {
    try {
      const { module: moduleName, action } = req.body;
      if (!moduleName || !moduleName.trim()) throw createError(400, "module is required");
      if (!action || !action.trim()) throw createError(400, "action (page key) is required");
      const cleanModule = moduleName.trim().toLowerCase();
      const cleanAction = action.trim().toLowerCase().replace(/\s+/g, "_");
      const code = `${cleanModule}.${cleanAction}`;

      const existing = await Permission.findOne({ where: { code } });
      if (existing) throw createError(409, "This module/page permission already exists");

      const permission = await Permission.create({
        module: cleanModule,
        action: cleanAction,
        code,
        created_by: req.user ? req.user.id : null,
      });
      res.status(201).json({ success: true, msg: "Permission created", data: permission });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/role-management/permissions/:id  (soft delete)
  deletePermission: async (req, res, next) => {
    try {
      const permission = await Permission.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!permission) throw createError(404, "Permission not found");
      await permission.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Permission deleted" });
    } catch (err) {
      next(err);
    }
  },

  // ---------------- Roles ----------------

  // GET /api/role-management  — every role, with its granted permission ids
  getAll: async (req, res, next) => {
    try {
      const roles = await Role.findAll({ where: { is_deleted: false }, order: [["role_name", "ASC"]] });
      const grants = await RolePermission.findAll({ where: { is_deleted: false } });

      const data = roles.map((r) => ({
        id: r.id,
        role_name: r.role_name,
        description: r.description,
        permission_ids: grants.filter((g) => g.role_id === r.id).map((g) => g.permission_id),
      }));
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/role-management/:id  — role + its full Permission objects
  getById: async (req, res, next) => {
    try {
      const role = await Role.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!role) throw createError(404, "Role not found");

      const grants = await RolePermission.findAll({ where: { role_id: role.id, is_deleted: false } });
      const permissionIds = grants.map((g) => g.permission_id);
      const permissions = permissionIds.length
        ? await Permission.findAll({ where: { id: { [Op.in]: permissionIds }, is_deleted: false } })
        : [];

      res.status(200).json({
        success: true,
        data: { id: role.id, role_name: role.role_name, description: role.description, permissions },
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/role-management  { role_name, description?, permission_ids?: [] }
  // Creates a custom role and (optionally) grants its initial permission set in one go.
  create: async (req, res, next) => {
    try {
      const { role_name, description, permission_ids } = req.body;
      if (!role_name || !role_name.trim()) throw createError(400, "role_name is required");

      const existing = await Role.findOne({ where: { role_name: role_name.trim(), is_deleted: false } });
      if (existing) throw createError(409, "A role with this name already exists");

      const role = await Role.create({
        role_name: role_name.trim(),
        description: description || null,
        created_by: req.user ? req.user.id : null,
      });

      if (Array.isArray(permission_ids) && permission_ids.length > 0) {
        const uniqueIds = [...new Set(permission_ids.map(Number))];
        const validCount = await Permission.count({ where: { id: { [Op.in]: uniqueIds }, is_deleted: false } });
        if (validCount !== uniqueIds.length) throw createError(400, "One or more permission_ids are invalid");

        await RolePermission.bulkCreate(
          uniqueIds.map((pid) => ({
            role_id: role.id,
            permission_id: pid,
            created_by: req.user ? req.user.id : null,
          }))
        );
      }

      res.status(201).json({ success: true, msg: `Role "${role.role_name}" created`, data: role });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/role-management/:id  { role_name?, description? }
  update: async (req, res, next) => {
    try {
      const role = await Role.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!role) throw createError(404, "Role not found");

      const { role_name, description } = req.body;
      if (role_name) {
        const dup = await Role.findOne({
          where: { role_name: role_name.trim(), is_deleted: false, id: { [Op.ne]: role.id } },
        });
        if (dup) throw createError(409, "A role with this name already exists");
      }

      const updates = { role_name: role_name ? role_name.trim() : undefined, description };
      Object.keys(updates).forEach((k) => updates[k] === undefined && delete updates[k]);
      updates.updated_by = req.user ? req.user.id : null;

      await role.update(updates);
      res.status(200).json({ success: true, msg: "Role updated", data: role });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/role-management/:id/permissions  { permission_ids: [] }
  // Replaces this role's ENTIRE permission set with exactly the given list
  // — the natural fit for a checklist + Save button (check/uncheck boxes,
  // Save applies the new full set in one call).
  setPermissions: async (req, res, next) => {
    try {
      const role = await Role.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!role) throw createError(404, "Role not found");

      const { permission_ids } = req.body;
      if (!Array.isArray(permission_ids)) throw createError(400, "permission_ids must be an array");

      const uniqueIds = [...new Set(permission_ids.map(Number))];
      if (uniqueIds.length > 0) {
        const validCount = await Permission.count({ where: { id: { [Op.in]: uniqueIds }, is_deleted: false } });
        if (validCount !== uniqueIds.length) throw createError(400, "One or more permission_ids are invalid");
      }

      const existing = await RolePermission.findAll({ where: { role_id: role.id, is_deleted: false } });
      const existingIds = existing.map((rp) => rp.permission_id);

      const toRemove = existing.filter((rp) => !uniqueIds.includes(rp.permission_id));
      const toAdd = uniqueIds.filter((pid) => !existingIds.includes(pid));

      await Promise.all(
        toRemove.map((rp) => rp.update({ is_deleted: true, updated_by: req.user ? req.user.id : null }))
      );
      if (toAdd.length > 0) {
        await RolePermission.bulkCreate(
          toAdd.map((pid) => ({ role_id: role.id, permission_id: pid, created_by: req.user ? req.user.id : null }))
        );
      }

      res.status(200).json({ success: true, msg: `Permissions updated for "${role.role_name}"` });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/role-management/:id  (soft delete — blocked if any user still holds this role)
  delete: async (req, res, next) => {
    try {
      const role = await Role.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!role) throw createError(404, "Role not found");

      const usersWithRole = await User.count({ where: { role_id: role.id, is_deleted: false } });
      if (usersWithRole > 0) {
        throw createError(
          400,
          `Can't delete "${role.role_name}" — ${usersWithRole} user(s) still have this role. Reassign them first.`
        );
      }

      await role.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Role deleted" });
    } catch (err) {
      next(err);
    }
  },

  // ---------------- Direct per-user permission overrides ----------------
  // Same shape as role permissions, but attached straight to one user —
  // for a single user who needs an extra page beyond their role's usual
  // set (e.g. one Warehouse user who also needs PO Approval), and for
  // attaching page permissions when approving a self-registration request.

  // GET /api/role-management/users/:userId/permissions
  getUserPermissions: async (req, res, next) => {
    try {
      const { UserPermission } = require("../models/index");
      const user = await User.findOne({ where: { id: req.params.userId, is_deleted: false } });
      if (!user) throw createError(404, "User not found");

      const grants = await UserPermission.findAll({ where: { user_id: user.id, is_deleted: false } });
      res.status(200).json({ success: true, data: { user_id: user.id, permission_ids: grants.map((g) => g.permission_id) } });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/role-management/users/:userId/permissions  { permission_ids?: [], pages?: [{module, page}] }
  // `pages` (module+page pairs) is the normal path from the UI — each one
  // is found-or-created in the Permission catalog on the spot, same as
  // registrationRequest.controller.js's approve(), so a page can be
  // granted without first separately registering it in the catalog.
  setUserPermissions: async (req, res, next) => {
    try {
      const { UserPermission } = require("../models/index");
      const user = await User.findOne({ where: { id: req.params.userId, is_deleted: false } });
      if (!user) throw createError(404, "User not found");

      const { permission_ids, pages } = req.body;
      const resolvedIds = new Set();
      if (permission_ids !== undefined) {
        if (!Array.isArray(permission_ids)) throw createError(400, "permission_ids must be an array");
        permission_ids.forEach((id) => resolvedIds.add(Number(id)));
      }
      if (Array.isArray(pages)) {
        for (const { module: moduleName, page } of pages) {
          if (!moduleName || !page) continue;
          const code = `${moduleName}.${page}`;
          const [permission] = await Permission.findOrCreate({
            where: { code },
            defaults: { module: moduleName, action: page, code, created_by: req.user ? req.user.id : null },
          });
          resolvedIds.add(permission.id);
        }
      }
      const uniqueIds = [...resolvedIds];

      if (uniqueIds.length > 0) {
        const validCount = await Permission.count({ where: { id: { [Op.in]: uniqueIds }, is_deleted: false } });
        if (validCount !== uniqueIds.length) throw createError(400, "One or more permissions are invalid");
      }

      const existing = await UserPermission.findAll({ where: { user_id: user.id, is_deleted: false } });
      const existingIds = existing.map((up) => up.permission_id);

      const toRemove = existing.filter((up) => !uniqueIds.includes(up.permission_id));
      const toAdd = uniqueIds.filter((pid) => !existingIds.includes(pid));

      await Promise.all(
        toRemove.map((up) => up.update({ is_deleted: true, updated_by: req.user ? req.user.id : null }))
      );
      if (toAdd.length > 0) {
        await UserPermission.bulkCreate(
          toAdd.map((pid) => ({ user_id: user.id, permission_id: pid, created_by: req.user ? req.user.id : null }))
        );
      }

      res.status(200).json({ success: true, msg: `Permissions updated for "${user.username}"` });
    } catch (err) {
      next(err);
    }
  },
};