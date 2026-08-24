const router = require("express").Router();
const Controller = require("../controllers/purchase.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// PO creation, rate negotiation, final purchase (Module 4)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(
  verifyAccessToken,
  attachUser,
  authorize("purchase", "admin", "sales", "gate", "warehouse", "lab"),
); // Protected routes

router.get("/grouped", Controller.getAllGrouped); // must be before "/:id" (GET) or it'd be swallowed as id="grouped"
router.get(
  "/pending-approval",
  authorize("admin"),
  Controller.getPendingApprovals,
);
router.get("/", Controller.getAll);
router.get("/:id", Controller.getById);
router.post("/", Controller.create);
router.post("/bulk", Controller.bulkCreate);
router.put(
  "/po/:po_no/approval-edit",
  authorize("admin"),
  Controller.updateBeforeApproval,
);

// Admin approves entire PO
router.patch("/po/:po_no/approve", authorize("admin"), Controller.approve);

// Admin rejects entire PO
router.patch("/po/:po_no/reject", authorize("admin"), Controller.reject);
router.post("/po/:po_no/items", Controller.addItem);
router.put("/po/:po_no/header", Controller.updateHeader);
router.put("/:id", Controller.update);
router.delete("/:id", Controller.delete);
router.post("/convert", Controller.convertToPurchase);

module.exports = router;
