const router = require("express").Router();
const Controller = require("../controllers/negotiation.controller");
const { verifyAccessToken, attachUser, authorize } = require("../middlewares/auth.middleware");

// Rate revision workflow (Module 7)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(verifyAccessToken, attachUser, authorize("purchase"));

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);

module.exports = router;
