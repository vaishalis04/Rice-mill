const router = require("express").Router();
const Controller = require("../controllers/auth.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Register / login / refresh / logout
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
// Public or shared-auth route group — apply middleware per-route if needed.

router.post("/register", Controller.register);
router.post("/login", Controller.login);
router.post("/refresh", Controller.refresh);
router.post("/logout", Controller.logout);
// Any logged-in user (no role restriction) — lets a custom role find out
// what it's been granted, since it can't call the admin-only
// /role-management endpoints itself.
router.get("/my-permissions", verifyAccessToken, attachUser, Controller.myPermissions);

module.exports = router;