const router = require("express").Router();
const Controller = require("../controllers/labTest.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Lab test parameters & verdicts (Module 6)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(verifyAccessToken, attachUser, authorize("lab","purchase","admin","sales","gate","warehouse")); // Protected routes

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);
router.patch("/:id/verdict", Controller.updateVerdict);

module.exports = router;
