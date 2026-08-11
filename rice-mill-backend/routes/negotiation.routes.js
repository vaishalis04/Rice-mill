const router = require("express").Router();
const Controller = require("../controllers/negotiation.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Rate revision workflow (Module 7)
router.use(verifyAccessToken, attachUser, authorize("purchase"));

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);
// Was "/:id/verdict" — didn't match the frontend's call to
// PATCH /negotiations/:id/respond, so every Accept/Reject click 404'd.
router.patch("/:id/respond", Controller.respond);

module.exports = router;