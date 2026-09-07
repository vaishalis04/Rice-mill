const express = require("express");
const router = express.Router();
const productionController = require("../controllers/production.controller");
// const { authenticate, authorize } = require("../middlewares/auth"); // keep whatever you already had

router.get("/", productionController.getAll);
router.get("/:id", productionController.getById);
router.post("/", productionController.create);
router.put("/:id", productionController.update);
router.delete("/:id", productionController.delete);

module.exports = router;