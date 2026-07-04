const router = require("express").Router();
const Controller = require("../controllers/packing.controller");
const { verifyAccessToken, attachUser, authorize } = require("../middlewares/auth.middleware");

// Batch/Lot/Barcode/QR generation (Module 16)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(verifyAccessToken, attachUser, authorize("production"));

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);

module.exports = router;
