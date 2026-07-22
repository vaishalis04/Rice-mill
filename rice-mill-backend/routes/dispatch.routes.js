const router = require("express").Router();
const Controller = require("../controllers/dispatch.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Challan, invoice, loading slip, direct outward dispatch (Module 19)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(verifyAccessToken, attachUser, authorize("dispatch"));

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);

module.exports = router;
