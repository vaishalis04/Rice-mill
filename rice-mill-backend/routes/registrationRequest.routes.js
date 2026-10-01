const router = require("express").Router();
const Controller = require("../controllers/registrationRequest.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Public — the "Register" link on the login page hits this with no token.
router.post("/", Controller.submit);

// Everything else (reviewing requests) is admin only.
router.get("/", verifyAccessToken, attachUser, authorize("admin"), Controller.getAll);
router.post("/:id/approve", verifyAccessToken, attachUser, authorize("admin"), Controller.approve);
router.post("/:id/reject", verifyAccessToken, attachUser, authorize("admin"), Controller.reject);

module.exports = router;