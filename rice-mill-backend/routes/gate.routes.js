const router = require("express").Router();
const Controller = require("../controllers/gate.controller");
const { verifyAccessToken, attachUser, authorize } = require("../middlewares/auth.middleware");

// Gate entry/exit, token & queue, driver photo capture (Module 1)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(verifyAccessToken, attachUser, authorize("gate"));

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);
router.post("/checkin", Controller.checkIn);
router.post("/checkout", Controller.checkOut);
router.post("/generatetoken", Controller.generateToken);

module.exports = router;
