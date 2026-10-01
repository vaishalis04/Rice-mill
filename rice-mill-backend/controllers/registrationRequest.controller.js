const createError = require("http-errors");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const {
  UserRegistrationRequest, User, Role, PlantMaster, Permission, UserPermission,
} = require("../models/index");
const { generateCode } = require("../helpers/helperFunction");

// Login page "Register" flow: someone fills in Name/Mobile/Email/Password,
// which lands here as a pending request — NOT a User yet. An admin reviews
// it on Admin > User Approvals, picks a Role and any extra page
// permissions, and only then does a real User get created. Deliberately
// separate from the existing POST /api/auth/register (untouched, still
// creates a User immediately — used elsewhere already).

const detailIncludes = [
  { model: User, as: "createdUser", attributes: ["id", "username"] },
  { model: User, as: "reviewer", attributes: ["id", "username"] },
];

module.exports = {
  // POST /api/registration-requests — public, no auth.
  submit: async (req, res, next) => {
    try {
      const { name, mobile, email, password } = req.body;
      if (!name || !name.trim()) throw createError(400, "Name is required");
      if (!mobile || !mobile.trim()) throw createError(400, "Mobile number is required");
      if (!email || !email.trim()) throw createError(400, "Email is required");
      if (!password || password.length < 6) throw createError(400, "Password must be at least 6 characters");

      const cleanMobile = mobile.trim();

      const existingUser = await User.findOne({
        where: { is_deleted: false, [Op.or]: [{ phone: cleanMobile }, { email: email.trim() }] },
      });
      if (existingUser) throw createError(409, "An account with this mobile number or email already exists");

      const existingRequest = await UserRegistrationRequest.findOne({
        where: { status: "pending", is_deleted: false, [Op.or]: [{ mobile: cleanMobile }, { email: email.trim() }] },
      });
      if (existingRequest) throw createError(409, "A registration request with this mobile number or email is already pending approval");

      const password_hash = await bcrypt.hash(password, 10);
      const request = await UserRegistrationRequest.create({
        name: name.trim(),
        mobile: cleanMobile,
        email: email.trim(),
        password_hash,
      });

      res.status(201).json({
        success: true,
        msg: "Registration request submitted. An admin will review it before you can log in.",
        data: { id: request.id, status: request.status },
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/registration-requests?status=pending — admin only.
  getAll: async (req, res, next) => {
    try {
      const { status } = req.query;
      const where = { is_deleted: false };
      if (status) where.status = status;

      const requests = await UserRegistrationRequest.findAll({
        where,
        include: detailIncludes,
        attributes: { exclude: ["password_hash"] },
        order: [["created_at", "DESC"]],
      });
      res.status(200).json({ success: true, data: requests });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/registration-requests/:id/approve — admin only.
  // { role_id, plant_id?, permission_ids?: [], pages?: [{module, page}] }
  // Creates the real User (username = mobile number, so "log in with
  // mobile no. and password" works immediately), assigns role_id, and
  // grants any extra pages directly to that user on top of their role's
  // usual set. `pages` is the normal path from the approval UI — each
  // {module, page} is found-or-created in the Permission catalog on the
  // spot, so an admin can tick ANY page from the full catalog without
  // first having to separately pre-register it on Roles & Permissions.
  // `permission_ids` still works too, for already-known Permission rows.
  approve: async (req, res, next) => {
    try {
      const request = await UserRegistrationRequest.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!request) throw createError(404, "Registration request not found");
      if (request.status !== "pending") throw createError(400, `This request has already been ${request.status}`);

      const { role_id, permission_ids, pages, plant_id } = req.body;
      if (!role_id) throw createError(400, "role_id is required");
      const role = await Role.findOne({ where: { id: role_id, is_deleted: false } });
      if (!role) throw createError(400, "Invalid role_id");

      if (plant_id) {
        const plant = await PlantMaster.findOne({ where: { id: plant_id, is_deleted: false } });
        if (!plant) throw createError(400, "Invalid plant_id");
      }

      // Guard against a race with the direct-register/user-create flows
      // between submission and approval.
      const clash = await User.findOne({
        where: { is_deleted: false, [Op.or]: [{ phone: request.mobile }, { email: request.email }] },
      });
      if (clash) throw createError(409, "A user with this mobile number or email was created in the meantime");

      const user = await User.create({
        username: request.mobile, // log in with mobile no. + password, per the brief
        email: request.email,
        phone: request.mobile,
        password_hash: request.password_hash, // already hashed at submission — never re-hash a hash
        role_id,
        plant_id: plant_id || null,
        employee_code: await generateCode(User, "employee_code", "EMP"),
      });

      // Resolve every requested page (module+page pair) to a real
      // Permission row, creating it if this is the first time it's ever
      // been granted to anyone — this is what removes the need to
      // pre-populate the catalog by hand before it's usable here.
      const resolvedIds = new Set();
      if (Array.isArray(permission_ids)) {
        permission_ids.forEach((id) => resolvedIds.add(Number(id)));
      }
      if (Array.isArray(pages) && pages.length > 0) {
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

      if (resolvedIds.size > 0) {
        const uniquePermissionIds = [...resolvedIds];
        const validCount = await Permission.count({ where: { id: { [Op.in]: uniquePermissionIds }, is_deleted: false } });
        if (validCount !== uniquePermissionIds.length) throw createError(400, "One or more permissions are invalid");
        await UserPermission.bulkCreate(
          uniquePermissionIds.map((pid) => ({ user_id: user.id, permission_id: pid, created_by: req.user ? req.user.id : null }))
        );
      }

      await request.update({
        status: "approved",
        created_user_id: user.id,
        reviewed_by: req.user ? req.user.id : null,
        reviewed_at: new Date(),
      });

      res.status(200).json({
        success: true,
        msg: `Approved — ${request.name} can now log in with mobile number ${request.mobile}.`,
        data: { user_id: user.id, username: user.username },
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/registration-requests/:id/reject — admin only. { reason? }
  reject: async (req, res, next) => {
    try {
      const request = await UserRegistrationRequest.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!request) throw createError(404, "Registration request not found");
      if (request.status !== "pending") throw createError(400, `This request has already been ${request.status}`);

      await request.update({
        status: "rejected",
        rejection_reason: req.body.reason || null,
        reviewed_by: req.user ? req.user.id : null,
        reviewed_at: new Date(),
      });

      res.status(200).json({ success: true, msg: "Registration request rejected" });
    } catch (err) {
      next(err);
    }
  },
};