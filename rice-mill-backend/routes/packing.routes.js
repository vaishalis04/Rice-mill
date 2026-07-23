const router = require("express").Router();
const Controller = require("../controllers/packing.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Batch/Lot/Barcode/QR generation (Module 16)
router.use(verifyAccessToken, attachUser, authorize("production"));

router.get("/",     Controller.getAll);
router.get("/graded-outputs/:batch_id", Controller.getGradedOutputs);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);

module.exports = router;
