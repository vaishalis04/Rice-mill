const router = require("express").Router();
const Controller = require("../controllers/reports.controller");
const { attachUser, authorize, authorizeRoleOrModule } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Day-wise, shift-wise, MIS, cycle/process-time reports (Module 23)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(verifyAccessToken, attachUser, authorizeRoleOrModule(["admin", "warehouse", "production"], ["warehouse", "production"]));

router.get("/gate-register", Controller.gateRegister);
router.get("/gate-summary", Controller.gateSummary); // vehicles still inside the mill (PO / SO / Lab / Loading / Unloading / Gate Pass)
router.get("/production-summary", Controller.productionSummary);
router.get("/material-flow", Controller.materialFlow);
router.get("/stock-report", Controller.stockReport);
router.get("/production-batch/:id/movement", Controller.productionBatchMovement); // materials used from / moved into which warehouse + stock before / after / now
router.get("/production-batch/:id/report", Controller.productionReport);
router.get("/daily-outward-pdf", Controller.dailyOutwardPdf);
router.get("/daily-report-pdf", Controller.dailyReportPdf);

module.exports = router;