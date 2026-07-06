const createError = require("http-errors");
const { User } = require("../models/index");

const attachUser = async (req, res, next) => {
  try {
    if (!req.userId) return next(createError.Unauthorized());
    const user = await User.findByPk(req.userId, { attributes: { exclude: ["password"] } });
    if (!user || user.is_inactive) return next(createError.Unauthorized("User not found"));
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return next(createError.Unauthorized());
  if (!roles.includes(req.user.role)) return next(createError.Forbidden("Access denied: insufficient permissions"));
  next();
};

module.exports = { attachUser, authorize };
