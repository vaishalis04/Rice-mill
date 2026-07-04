const router = require("express").Router();
const Controller = require("../controllers/inventory.controller");
const { verifyAccessToken, attachUser, authorize } = require("../middlewares/auth.middleware");

// Real-time stock ledger across all stages (Module 10)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(verifyAccessToken, attachUser, authorize("warehouse"));

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);
router.post("/ledger", Controller.ledger);

module.exports = router;
