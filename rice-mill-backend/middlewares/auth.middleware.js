const createError = require("http-errors");
const { User ,Role } = require("../models/index");

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
  if (!userRole || !roles.includes(userRole)) {
    return next(createError.Forbidden("Access denied: insufficient permissions"));
  }
  next();
};


module.exports = { attachUser, authorize };
