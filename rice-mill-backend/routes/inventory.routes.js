const router = require("express").Router();
const Controller = require("../controllers/inventory.controller");
const ReportController = require("../controllers/inventoryReport.controller");
const { attachUser, authorize, authorizeRoleOrModule } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Real-time stock ledger across all stages (Module 10)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(verifyAccessToken, attachUser, authorizeRoleOrModule(["warehouse","production","gate","dispatch","sales","admin","lab"], ["warehouse","production","gate","dispatch","sales","lab"])); // Protected routes

// NOTE: "/stock-summary" must be registered before "/:id" — otherwise
// Express matches it into the ":id" handler first (id would end up being
// the literal string "stock-summary").
router.get("/",     Controller.getAll);
router.get("/stock-summary", Controller.getStockSummary);
// Inventory reports (PDF) — also before "/:id".
router.get("/report-filters", ReportController.filters);
router.get("/report-pdf", ReportController.reportPdf);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);
router.post("/ledger", Controller.ledger);

module.exports = router;