const router = require("express").Router();
const Controller = require("../controllers/weighbridge.controller");
const { attachUser, authorize, authorizeRoleOrModule } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Gross / Tare / Net capture, slip printing (Module 8)
// Allow any authenticated user to READ weight slips (so Warehouse can query
// which gate entries originated from the weighbridge), but keep create/update
///delete restricted to the Gate role.
router.use(verifyAccessToken, attachUser);

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);

router.post("/",    authorizeRoleOrModule(["gate", "weighbridge"], ["weighbridge"]), Controller.create);
router.put("/:id",  authorizeRoleOrModule(["gate", "weighbridge"], ["weighbridge"]), Controller.update);
router.delete("/:id", authorizeRoleOrModule(["gate", "weighbridge"], ["weighbridge"]), Controller.delete);

module.exports = router;