const router = require("express").Router();
const Controller = require("../controllers/materialSlip.controller");
const { attachUser, authorizeRoleOrModule } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Same roles/modules that can already work with Lots (inward) and Loading (outward).
router.use(verifyAccessToken, attachUser, authorizeRoleOrModule(["admin", "warehouse", "gate"], ["warehouse", "gate"]));

router.get("/inward/:lotId", Controller.inwardSlipPdf);
router.get("/outward/:loadingId", Controller.outwardSlipPdf);

module.exports = router;