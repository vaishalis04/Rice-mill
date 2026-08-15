const router = require("express").Router();
const Controller = require("../controllers/gate.controller");
const { attachUser, authorize } = require("../middlewares/auth.middleware");
const { verifyAccessToken } = require("../helpers/jwt.helper");
const { uploadImage } = require("../helpers/multer.helper");

// Gate entry/exit, token & queue, driver photo capture (Module 1)
// "lab" is included because Quality's Sampling page needs to read gate
// entries at status 'waiting_sampling' to populate its picker.
// "purchase" is included because Purchase Orders' gate-entry picker reads
// from here too.
router.use(verifyAccessToken, attachUser, authorize("gate","warehouse","production","lab","purchase"));

router.get("/",     Controller.getAll);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);
router.post("/checkin", Controller.checkIn);
router.post("/checkout", Controller.checkOut);
router.post("/generatetoken", Controller.generateToken);
// Empty trucks / miscellaneous-item trucks (entry_type = "other") only —
// skips the rest of the journey and marks the truck received at warehouse.
router.post("/send-to-warehouse", Controller.sendToWarehouse);
// Uploads a captured/chosen driver photo to disk and returns its URL — the
// URL (a short path, not the image itself) is what actually gets saved on
// the gate entry's driver_photo_url column.
router.post("/upload-photo", uploadImage.single("photo"), Controller.uploadPhoto);

module.exports = router;