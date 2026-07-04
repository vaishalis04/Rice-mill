const multer = require("multer");
const path = require("path");

// TODO: configure storage destinations per use-case:
// - driver photo capture (Module 1: Gate Management)
// - vendor PO/DO uploads (Module 2: Vendor Portal)
// - QR/barcode label assets (Module 16: Packing)

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "..", "uploads")),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const upload = multer({ storage });

module.exports = upload;
