const router = require("express").Router();
const Controller = require("../controllers/inventory.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Real-time stock ledger across all stages (Module 10)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
<<<<<<< HEAD
router.use(verifyAccessToken, attachUser, authorize("warehouse","production","gate","dispatch","sales","admin","lab")); // Protected routes
=======
router.use(verifyAccessToken, attachUser, authorize("warehouse","production","gate"));
>>>>>>> 46b2f643364081a7c6d365a09f3d10eb849c3470

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);
router.post("/ledger", Controller.ledger);

module.exports = router;
