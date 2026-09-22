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
// "admin" is included because Admin > Gate Entry now attaches Entry Type /
// PO / SO details onto the tokens the Gate creates (see attachDetails).
router.use(verifyAccessToken, attachUser, authorize("gate","warehouse","production","lab","purchase","weighbridge","admin"));

router.get("/",     Controller.getAll);
// Must come before "/:id" — otherwise Express would treat "misc-items" as
// an :id value for getById.
router.get("/misc-items", Controller.getMiscItems);
router.get("/:id",  Controller.getById);
router.post("/",    Controller.create);
router.put("/:id",  Controller.update);
router.delete("/:id", Controller.delete);
router.post("/checkin", Controller.checkIn);
router.post("/checkout", Controller.checkOut);
// Gate side — Vehicle + Driver (+ Driver Photo) only, prints a token.
router.post("/generatetoken", Controller.generateToken);
// Admin side — attaches Entry Type + PO/SO + Challan/Expected Qty onto a
// token generated above; restricted to admin only.
router.post(
  "/attach-details",
  authorize("admin"),
  Controller.attachDetails
);
// Empty trucks / miscellaneous-item trucks (entry_type = "other") only —
// skips the rest of the journey and marks the truck received at warehouse.
router.post("/send-to-warehouse", Controller.sendToWarehouse);
// Uploads a captured/chosen driver photo to disk and returns its URL — the
// URL (a short path, not the image itself) is what actually gets saved on
// the gate entry's driver_photo_url column.
router.post("/upload-photo", uploadImage.single("photo"), Controller.uploadPhoto);

module.exports = router;