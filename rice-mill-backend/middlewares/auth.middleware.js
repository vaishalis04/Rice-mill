const createError = require("http-errors");
const { Op } = require("sequelize");
const { User, Role, Permission, RolePermission } = require("../models/index");

// const attachUser = async (req, res, next) => {
//   try {
//     if (!req.userId) return next(createError.Unauthorized());
//     const user = await User.findByPk(req.userId, { attributes: { exclude: ["password"] } });
//     if (!user || user.is_inactive) return next(createError.Unauthorized("User not found"));
//     req.user = user;
//     next();
//   } catch (err) {
//     next(err);
//   }
// };

// const authorize = (...roles) => (req, res, next) => {
//   console.log("authorize middleware: req.user =", req.user);
//   if (!req.user) return next(createError.Unauthorized());
//     console.log("user role:", JSON.stringify(req.user.role_id), "expected:", roles); // temp debug
//   if (!roles.includes(req.user.role)) return next(createError.Forbidden("Access denied: insufficient permissions"));
//   next();
// };

const attachUser = async (req, res, next) => {
  try {
    if (!req.userId) return next(createError.Unauthorized());
    const user = await User.findByPk(req.userId, {
      attributes: { exclude: ["password"] },
      include: [{ model: Role, as: "role", attributes: ["id", "role_name"] }],
    });
    if (!user || user.is_inactive) return next(createError.Unauthorized("User not found"));
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
  const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return next(createError.Unauthorized());
  const userRole = req.user.role?.role_name;
  if (!userRole || !roles.map(r => r.toLowerCase()).includes(userRole.toLowerCase())) {
    return next(createError.Forbidden("Access denied: insufficient permissions"));
  }
  next();
};

// Permission-based authorization — checks the user's role against
// ACTUALLY GRANTED permissions (role_permissions -> permissions.code),
// instead of a hardcoded role-name whitelist like authorize() above.
//
// This is what makes a custom role (created via Admin > Roles &
// Permissions) able to access something: authorize("admin","warehouse")
// will NEVER let a brand-new custom role through, no matter what it's
// been granted, because it isn't literally named "admin" or "warehouse".
//
// Existing routes are untouched by adding this — migrate a route to
// requirePermission(...) deliberately, one at a time, once you actually
// want it to respect custom-role grants instead of the fixed role-name
// list. Until a route is migrated, custom roles simply can't reach it.
//
// Usage: router.get("/", verifyAccessToken, attachUser, requirePermission("warehouse.read"), Controller.getAll);
// A user passes if their role holds ANY of the listed codes (OR, not AND) —
// mirrors how authorize(...roles) already treats multiple role names.
const requirePermission = (...codes) => async (req, res, next) => {
  try {
    if (!req.user) return next(createError.Unauthorized());
    const roleId = req.user.role_id || req.user.role?.id;
    if (!roleId) return next(createError.Forbidden("Access denied: no role assigned"));

    const grants = await RolePermission.findAll({
      where: { role_id: roleId, is_deleted: false },
    });
    if (grants.length === 0) {
      return next(createError.Forbidden("Access denied: insufficient permissions"));
    }

    const grantedPermissionIds = grants.map((g) => g.permission_id);
    const matched = await Permission.count({
      where: {
        id: { [Op.in]: grantedPermissionIds },
        code: { [Op.in]: codes },
        is_deleted: false,
      },
    });

    if (matched === 0) {
      return next(createError.Forbidden("Access denied: insufficient permissions"));
    }
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { attachUser, authorize, requirePermission, authorizeRoleOrModule };

// Passes if EITHER the user's literal role_name matches one of `roleNames`
// (exactly what authorize() above already does — zero behavior change for
// the 9 built-in roles) OR, for anyone else (a custom role created via
// Admin > Roles & Permissions), their role has been granted ANY permission
// whose `module` is in `modules`. This is what lets a custom role actually
// reach a module's API once Admin has ticked it in Roles & Permissions —
// without it, every route stays closed to custom roles no matter what's
// granted, since none of them are literally named e.g. "gate" or "lab".
//
// Usage: router.use(verifyAccessToken, attachUser,
//   authorizeRoleOrModule(["gate","warehouse","admin"], ["gate"]));
function authorizeRoleOrModule(roleNames = [], modules = []) {
  return async (req, res, next) => {
    try {
      if (!req.user) return next(createError.Unauthorized());

      const userRole = req.user.role?.role_name;
      if (
        userRole &&
        roleNames.map((r) => r.toLowerCase()).includes(userRole.toLowerCase())
      ) {
        return next();
      }

      const roleId = req.user.role_id || req.user.role?.id;
      if (!roleId) {
        return next(createError.Forbidden("Access denied: insufficient permissions"));
      }

      const grants = await RolePermission.findAll({
        where: { role_id: roleId, is_deleted: false },
      });
      if (grants.length === 0) {
        return next(createError.Forbidden("Access denied: insufficient permissions"));
      }

      const grantedPermissionIds = grants.map((g) => g.permission_id);
      const matched = await Permission.count({
        where: {
          id: { [Op.in]: grantedPermissionIds },
          module: { [Op.in]: modules.map((m) => m.toLowerCase()) },
          is_deleted: false,
        },
      });

      if (matched === 0) {
        return next(createError.Forbidden("Access denied: insufficient permissions"));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}