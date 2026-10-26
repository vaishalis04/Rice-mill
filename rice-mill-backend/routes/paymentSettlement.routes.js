const router = require("express").Router();
const Controller = require("../controllers/paymentSettlement.controller");
const { attachUser, authorizeRoleOrModule } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Admin and the Advisory role (unchanged), plus any user / custom role that has
// been granted the Payment Settlement page — either "Payment Settlement"
// under Other Pages (admin.payment_settlement) or the Advisory dashboard's
// "Payment Settlement Advice" (advisory.payment_settlement).
router.use(
  verifyAccessToken,
  attachUser,
  authorizeRoleOrModule(["admin", "advisory"], [], { codes: ["admin.payment_settlement", "advisory.payment_settlement"] })
);

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