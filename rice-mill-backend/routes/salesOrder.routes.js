const router = require("express").Router();
const Controller = require("../controllers/salesOrder.controller");
const { verifyAccessToken, attachUser, authorize } = require("../middlewares/auth.middleware");

// Order booking, allocation (Module 18)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(verifyAccessToken, attachUser, authorize("sales"));

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);

module.exports = router;
