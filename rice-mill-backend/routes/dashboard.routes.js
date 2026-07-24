const router = require("express").Router();
const Controller = require("../controllers/dashboard.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");


// Real-time KPIs (Module 24)
// Any authenticated role can view the dashboard.
router.use(verifyAccessToken, attachUser, authorize("admin", "gate", "lab", "purchase", "warehouse", "production", "sales", "dispatch"));

router.get("/kpis", Controller.getKpis);
router.get("/daily-intake-trend", Controller.getDailyIntakeTrend);

module.exports = router;
