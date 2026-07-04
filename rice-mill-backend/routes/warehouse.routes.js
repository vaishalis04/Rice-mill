const router = require("express").Router();
const Controller = require("../controllers/warehouse.controller");
const { verifyAccessToken, attachUser, authorize } = require("../middlewares/auth.middleware");

// Stack/Bin/Lot, raw material storage (Module 9)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(verifyAccessToken, attachUser, authorize("warehouse"));

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);

module.exports = router;
