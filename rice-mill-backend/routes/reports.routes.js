const router = require("express").Router();
const Controller = require("../controllers/reports.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Day-wise, shift-wise, MIS, cycle/process-time reports (Module 23)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(verifyAccessToken, attachUser, authorize("admin"));

router.get("/gate-register", Controller.gateRegister);
router.get("/production-summary", Controller.productionSummary);
router.get("/material-flow", Controller.materialFlow);

module.exports = router;
