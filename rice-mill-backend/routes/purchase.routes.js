const router = require("express").Router();
const Controller = require("../controllers/purchase.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// PO creation, rate negotiation, final purchase (Module 4)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(verifyAccessToken, attachUser, authorize("purchase","admin","sales","gate","warehouse","lab")); // Protected routes

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);
router.post("/convert", Controller.convertToPurchase);


module.exports = router;
