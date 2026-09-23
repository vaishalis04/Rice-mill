const router = require("express").Router();
const Controller = require("../controllers/masterSettings.controller");
const { attachUser, authorize, authorizeRoleOrModule } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Org / plant / UOM / variety / rate / reason-code masters (Module 25)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(verifyAccessToken, attachUser, authorizeRoleOrModule(
  ["admin","production","warehouse","gate","dispatch","sales","lab","purchase"],
  ["production","warehouse","gate","dispatch","sales","lab","purchase","weighbridge"]
)); // Protected routes

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);

module.exports = router;