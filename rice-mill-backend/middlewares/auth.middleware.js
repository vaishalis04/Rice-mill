const { verifyAccessToken } = require("../helpers/jwt.helper");

// TODO: implement — attach decoded user (and role) onto req
const attachUser = async (req, res, next) => {
  try {
    // req.userId is set by verifyAccessToken; fetch full user + role here
    next();
  } catch (err) {
    next(err);
  }
};

// TODO: implement — allow only given role(s) to proceed
const authorize = (...roles) => (req, res, next) => {
  // check req.user.role against `roles`
  next();
};

module.exports = { verifyAccessToken, attachUser, authorize };
