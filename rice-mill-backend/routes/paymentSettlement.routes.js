const router = require("express").Router();
const Controller = require("../controllers/paymentSettlement.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Admin and the new Advisory role — same access list as advisoryTruck.routes.js.
router.use(verifyAccessToken, attachUser, authorize("admin", "advisory"));

// Auto-fetch: find the truck (by GP No. / SO No. / PO No. / vehicle / party) a
// settlement is being made against, then pre-fill the form from it. Declared
// before "/:id" so "sources" and "source" are never mistaken for an id.
router.get("/sources", Controller.sources);
router.get("/source/:gateEntryId", Controller.source);

router.get("/", Controller.getAll);
router.get("/:id", Controller.getById);
router.get("/:id/pdf", Controller.generatePdf);
router.post("/", Controller.create);
router.put("/:id", Controller.update);
router.delete("/:id", Controller.delete);

module.exports = router;