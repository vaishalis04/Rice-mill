const router = require("express").Router();
const Controller = require("../controllers/inventory.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Real-time stock ledger across all stages (Module 10)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(verifyAccessToken, attachUser, authorize("warehouse","production","gate","dispatch","sales","admin","lab")); // Protected routes

// NOTE: "/stock-summary" must be registered before "/:id" — otherwise
// Express matches it into the ":id" handler first (id would end up being
// the literal string "stock-summary").
router.get("/",     Controller.getAll);
router.get("/stock-summary", Controller.getStockSummary);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);
router.post("/ledger", Controller.ledger);

module.exports = router;