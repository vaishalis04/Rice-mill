const router = require("express").Router();
const Controller = require("../controllers/weighbridge.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Gross / Tare / Net capture, slip printing (Module 8)
// Allow any authenticated user to READ weight slips (so Warehouse can query
// which gate entries originated from the weighbridge), but keep create/update
///delete restricted to the roles that actually operate the weighbridge.
// `dispatch` was added here when the Dispatch role's dashboard was
// switched from its own weight-entry page to this one — that landing
// page swap is pointless if the role can view but not actually use it.
router.use(verifyAccessToken, attachUser);

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);

router.post("/",    authorize("gate", "dispatch"), Controller.create);
router.put("/:id",  authorize("gate", "dispatch"), Controller.update);
router.delete("/:id", authorize("gate", "dispatch"), Controller.delete);

module.exports = router;