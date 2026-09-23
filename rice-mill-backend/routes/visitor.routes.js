const router = require("express").Router();
const Controller = require("../controllers/visitor.controller");
const { attachUser, authorize, authorizeRoleOrModule } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Visitor gate pass (Gate Management) — normal visits, no vehicle/material.
router.use(verifyAccessToken, attachUser, authorizeRoleOrModule(["gate", "admin"], ["gate"]));

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.patch("/:id/checkout", Controller.checkOut);
router.delete("/:id", Controller.delete);

module.exports = router;