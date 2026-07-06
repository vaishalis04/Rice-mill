const router = require("express").Router();
const Controller = require("../controllers/auth.controller");
const { verifyAccessToken, attachUser, authorize } = require("../middlewares/auth.middleware");

// Register / login / refresh / logout
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
// Public or shared-auth route group — apply middleware per-route if needed.

router.post("/register", Controller.register);
router.post("/login", Controller.login);
router.post("/refresh", Controller.refresh);
router.post("/logout", Controller.logout);

module.exports = router;
