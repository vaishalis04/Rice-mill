const router = require("express").Router();
const Controller = require("../controllers/reports.controller");
const { verifyAccessToken, attachUser, authorize } = require("../middlewares/auth.middleware");

// Day-wise, shift-wise, MIS, cycle/process-time reports (Module 23)
// TODO: split public vs protected routes as needed; adjust authorize() role(s).
router.use(verifyAccessToken, attachUser, authorize("admin"));

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);

module.exports = router;
