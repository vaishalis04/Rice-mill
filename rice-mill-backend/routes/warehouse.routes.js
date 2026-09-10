const router = require("express").Router();
const Controller = require("../controllers/warehouse.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Stack/Bin/Lot, raw material storage (Module 9)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(verifyAccessToken, attachUser, authorize("warehouse", "gate", "production"));

// NOTE: literal paths ("/stock", "/stock-detail") must be registered
// BEFORE "/:id" — otherwise Express matches them into the ":id" handler
// first (id would end up being the literal string "stock"). This was
// already silently broken for "/stock" before; fixed by reordering here.
router.get("/", Controller.getAll);
router.get("/stock", Controller.getStock);
router.get("/stock-detail", Controller.getStockDetail);
// Own authorize() here (not the group-wide one above) — this is a data-
// migration tool, squarely an admin task, and the group above doesn't
// include "admin" at all.
router.post(
  "/opening-stock/bulk-import",
  authorize("admin", "warehouse"),
  Controller.bulkImportOpeningStock
);
router.get("/:id/summary", Controller.getSummary);
router.get("/:id", Controller.getById);
router.post("/", Controller.create);
router.put("/:id", Controller.update);
router.delete("/:id", Controller.delete);

module.exports = router;