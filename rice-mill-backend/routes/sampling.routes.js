const router = require("express").Router();
const Controller = require("../controllers/sampling.controller");
const { verifyAccessToken, attachUser, authorize } = require("../middlewares/auth.middleware");

// Sample collection & chain-of-custody (Module 5)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(verifyAccessToken, attachUser, authorize("lab"));

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);

module.exports = router;
