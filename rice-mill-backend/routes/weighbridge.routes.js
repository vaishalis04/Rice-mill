const router = require("express").Router();
const Controller = require("../controllers/weighbridge.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Gross / Tare / Net capture, slip printing (Module 8)
// Allow any authenticated user to READ weight slips (so Warehouse can query
// which gate entries originated from the weighbridge), but keep create/update
///delete restricted to the Gate role.
router.use(verifyAccessToken, attachUser);

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);

router.post("/",    authorize("gate"), Controller.create);
router.put("/:id",  authorize("gate"), Controller.update);
router.delete("/:id", authorize("gate"), Controller.delete);

module.exports = router;
