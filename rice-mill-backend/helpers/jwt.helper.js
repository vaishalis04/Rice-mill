const jwt = require("jsonwebtoken");

// TODO: implement token generation
const generateAccessToken = (payload) => {
  // return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1d" });
};

// TODO: implement Express middleware that verifies Bearer token and sets req.userId
const verifyAccessToken = (req, res, next) => {
  next();
};

module.exports = { generateAccessToken, verifyAccessToken };
