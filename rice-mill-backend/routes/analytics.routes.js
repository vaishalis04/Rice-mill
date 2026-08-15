const router = require("express").Router();
const Controller = require("../controllers/analytics.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Admin analytics dashboard (Module: real-time KPIs, charts, fleet snapshot)
router.use(verifyAccessToken, attachUser, authorize("admin"));

router.get("/summary", Controller.summary);
router.get("/production-trend", Controller.productionTrend);
router.get("/material-flow", Controller.materialFlow);
router.get("/fleet-snapshot", Controller.fleetSnapshot);
router.get("/gate-activity", Controller.gateActivity);

module.exports = router;