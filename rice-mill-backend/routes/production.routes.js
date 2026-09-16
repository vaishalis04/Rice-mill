const express = require("express");
const router = express.Router();
const productionController = require("../controllers/production.controller");
// const { authenticate, authorize } = require("../middlewares/auth"); // keep whatever you already had

// NOTE: the frontend's api.js posts new batches to plain "/production" but
// calls everything else (list, get-one, materials sub-resource) under
// "/production/batches" — so this single router needs to answer to BOTH
// prefixes no matter how app.js mounts it. Without an explicit "/batches"
// route here, Express falls through to "/:id" and treats the literal word
// "batches" as an id (producing a bogus "Production batch not found").
// These are registered before "/:id" so the literal path always wins.
router.get("/batches", productionController.getAll);
router.get("/batches/:id", productionController.getById);
router.post("/batches", productionController.create);
router.put("/batches/:id", productionController.update);
router.post("/batches/:id/materials", productionController.addMaterial);
router.put("/batches/:id/materials/:materialId", productionController.updateMaterial);
router.put("/batches/:id/materials/:materialId/swap", productionController.swapMaterial);
router.delete("/batches/:id/materials/:materialId", productionController.removeMaterial);
router.delete("/batches/:id", productionController.delete);

router.get("/", productionController.getAll);
router.get("/:id", productionController.getById);
router.post("/", productionController.create);
router.put("/:id", productionController.update);
router.post("/:id/materials", productionController.addMaterial);
router.put("/:id/materials/:materialId", productionController.updateMaterial);
router.put("/:id/materials/:materialId/swap", productionController.swapMaterial);
router.delete("/:id/materials/:materialId", productionController.removeMaterial);
router.delete("/:id", productionController.delete);

module.exports = router;