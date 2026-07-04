const router = require("express").Router();
const Controller = require("../controllers/vendorPortal.controller");
const { verifyAccessToken, attachUser, authorize } = require("../middlewares/auth.middleware");

// Vendor self-service portal: PO/DO upload (Module 2)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(verifyAccessToken, attachUser, authorize("vendor"));

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);
router.post("/uploadpo", Controller.uploadPO);
router.post("/uploaddo", Controller.uploadDO);

module.exports = router;
