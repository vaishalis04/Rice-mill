const router = require("express").Router();
const Controller = require("../controllers/auth.controller");
const { verifyAccessToken, attachUser, authorize } = require("../middlewares/auth.middleware");

// Register / login / refresh / logout
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
// Public or shared-auth route group — apply middleware per-route if needed.

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);

module.exports = router;
