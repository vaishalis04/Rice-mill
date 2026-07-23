const router = require("express").Router();
const Controller = require("../controllers/production.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");
// Batch creation, stage routing (Module 11)
router.use(verifyAccessToken, attachUser, authorize("production"));

router.get("/batches",     Controller.getAll);
router.get("/batches/:id", Controller.getById);
router.post("/batches",    Controller.create);
router.put("/batches/:id", Controller.update);
router.delete("/batches/:id", Controller.delete);

router.patch("/batches/:id/dryer",          Controller.dryerStage);
router.patch("/batches/:id/milling",        Controller.millingStage);
router.patch("/batches/:id/separator",      Controller.separatorStage);
router.patch("/batches/:id/shiner",         Controller.shinerStage);
router.patch("/batches/:id/color-sorter",   Controller.colorSorterStage);
router.patch("/batches/:id/length-grading", Controller.lengthGradingStage);

module.exports = router;
