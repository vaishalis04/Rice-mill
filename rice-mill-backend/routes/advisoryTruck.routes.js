const router = require("express").Router();
const Controller = require("../controllers/advisoryTruck.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// "Advisory Trucks" — Admin, plus the dedicated Advisory role it's also
// now available on (Admin > Advisory Trucks is unchanged; this just also
// lets the Advisory dashboard reach the same data/actions).
router.use(verifyAccessToken, attachUser, authorize("admin", "advisory"));

router.get("/", Controller.getAll);
router.patch("/:id", Controller.update);

module.exports = router;