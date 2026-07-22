const router = require("express").Router();
const Controller = require("../controllers/lot.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Unloading & Lot traceability (Module 9 workflow entry point)
router.use(verifyAccessToken, attachUser, authorize("warehouse"));

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);
router.patch("/:id/route", Controller.route);

module.exports = router;
