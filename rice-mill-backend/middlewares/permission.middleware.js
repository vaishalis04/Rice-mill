// TODO: implement fine-grained module/action permission checks
// backed by permissions + role_permissions tables (architecture doc Section 11:
// User Permission Matrix).
//
// Usage (planned): router.use(checkPermission("gate_management", "create"))

const checkPermission = (module, action) => (req, res, next) => {
  // TODO: look up req.user.role_id -> role_permissions -> permissions
  // and confirm { module, action } is allowed
  next();
};

module.exports = { checkPermission };
