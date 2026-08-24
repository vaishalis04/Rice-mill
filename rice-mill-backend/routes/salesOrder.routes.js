const router = require("express").Router();
const Controller = require("../controllers/salesOrder.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Order booking, allocation (Module 18)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(
  verifyAccessToken,
  attachUser,
  authorize("sales", "admin", "gate", "warehouse", "lab", "dispatch"),
); // Protected routes

router.get(
  "/pending-approval",
  authorize("admin"),
  Controller.getPendingApprovals,
);

// Admin edit pending SO
router.put(
  "/so/:so_no/approval-edit",
  authorize("admin"),
  Controller.updateBeforeApproval,
);

// Admin approve SO
router.patch("/so/:so_no/approve", authorize("admin"), Controller.approve);

// Admin reject SO
router.patch("/so/:so_no/reject", authorize("admin"), Controller.reject);
router.get("/grouped", Controller.getAllGrouped);
router.get("/", Controller.getAll);
router.get("/:id", Controller.getById);
router.post("/", Controller.create);
router.post("/bulk", Controller.bulkCreate);
router.post("/so/:so_no/items", Controller.addItem);
router.put("/so/:so_no/header", Controller.updateHeader);
router.put("/:id", Controller.update);
router.delete("/:id", Controller.delete);

module.exports = router;
