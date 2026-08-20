const router = require("express").Router();
const Controller = require("../controllers/loading.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Outbound loading capture at the gate (entry_type = "sales" flow, Gate module)
router.use(verifyAccessToken, attachUser, authorize("gate", "warehouse"));

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);

module.exports = router;