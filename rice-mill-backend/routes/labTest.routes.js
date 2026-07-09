const router = require("express").Router();
const Controller = require("../controllers/labTest.controller");
const { verifyAccessToken, attachUser, authorize } = require("../middlewares/auth.middleware");

// Lab test parameters & verdicts (Module 6)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(verifyAccessToken, attachUser, authorize("lab"));

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);
router.patch("/:id/verdict", Controller.updateVerdict);

module.exports = router;
