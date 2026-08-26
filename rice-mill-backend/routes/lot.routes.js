const router = require("express").Router();
const Controller = require("../controllers/lot.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");

// Unloading & Lot traceability (Module 9 workflow entry point)
router.use(verifyAccessToken, attachUser, authorize("warehouse","production"));

router.get("/", Controller.getAll);
router.get("/:id", Controller.getById);
router.post("/start-unloading", Controller.startUnloading);

// CHANGE THIS: Remove :id from the route since controller expects items in body
router.patch("/complete-unloading", Controller.completeUnloading);
// OR use POST if you prefer
// router.post("/complete-unloading", Controller.completeUnloading);

router.put("/:id", Controller.update);
router.delete("/:id", Controller.delete);
router.patch("/:id/route", Controller.route);

module.exports = router;