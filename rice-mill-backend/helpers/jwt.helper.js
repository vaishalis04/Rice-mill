const JWT = require("jsonwebtoken");
const createError = require("http-errors");

const signAccessToken = (userId) =>
  new Promise((resolve, reject) => {
    JWT.sign({ id: userId }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRY || "1d" }, (err, token) => {
      if (err) return reject(createError.InternalServerError());
      resolve(token);
    });
  });

const signRefreshToken = (userId) =>
  new Promise((resolve, reject) => {
    JWT.sign({ id: userId }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: process.env.REFRESH_TOKEN_EXPIRY || "7d" }, (err, token) => {
      if (err) return reject(createError.InternalServerError());
      resolve(token);
    });
  });

const verifyAccessToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return next(createError.Unauthorized("Access token required"));
  const token = authHeader.split(" ")[1];
  if (!token) return next(createError.Unauthorized("Access token required"));
  JWT.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, payload) => {
    if (err) return next(createError.Unauthorized(err.name === "JsonWebTokenError" ? "Unauthorized" : err.message));
    req.userId = payload.id;
    next();
  });
};

const verifyRefreshToken = (refreshToken) =>
  new Promise((resolve, reject) => {
    JWT.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET, (err, payload) => {
      if (err) return reject(createError.Unauthorized());
      resolve(payload.id);
    });
  });

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken };
