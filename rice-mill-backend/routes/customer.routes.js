const router = require("express").Router();
const Controller = require("../controllers/customer.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Customer master incl. by-product buyers
router.use(verifyAccessToken, attachUser, authorize("Sales", "admin", "dispatch"));

router.get("/",     Controller.getAll);
router.get("/:id/history", Controller.getHistory);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);

module.exports = router;