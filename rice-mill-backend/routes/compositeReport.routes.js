const router = require("express").Router();
const Controller = require("../controllers/compositeReport.controller");
const { attachUser, authorizeRoleOrModule } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Composite Report (Incoming Approval Slip) — generated from a tested sample.
// Quality (lab) module + admin.
router.use(verifyAccessToken, attachUser, authorizeRoleOrModule(["lab", "admin"], ["lab"]));

router.get("/", Controller.getAll);
router.get("/source/:lab_test_id", Controller.source);
router.get("/:id/pdf", Controller.pdf);
router.get("/:id", Controller.getById);
router.post("/", Controller.create);
router.put("/:id", Controller.update);
router.delete("/:id", Controller.delete);

module.exports = router;
