const router = require("express").Router();
const Controller = require("../controllers/dashboard.controller");
const { attachUser, authorize, authorizeRoleOrModule } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");


// Real-time KPIs (Module 24)
// Any authenticated role can view the dashboard — for a custom role, any
// one granted module is enough (this just powers the shared KPI strip
// shown at the top of every dashboard, not module-specific data).
router.use(verifyAccessToken, attachUser, authorizeRoleOrModule(
  ["admin", "gate", "lab", "purchase", "warehouse", "production", "sales", "dispatch"],
  ["gate", "lab", "purchase", "warehouse", "production", "sales", "weighbridge", "dispatch"]
));

router.get("/kpis", Controller.getKpis);
router.get("/daily-intake-trend", Controller.getDailyIntakeTrend);

module.exports = router;