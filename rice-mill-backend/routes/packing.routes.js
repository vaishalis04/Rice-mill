const express = require("express");
const router = express.Router();
const packingController = require("../controllers/packing.controller");

router.get("/", packingController.getAll);
router.get("/:id", packingController.getById);
router.post("/complete", packingController.completeAndPack);
router.put("/:id", packingController.update);
router.delete("/:id", packingController.delete);

module.exports = router;