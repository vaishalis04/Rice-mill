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

// Image-only variant with a size cap — for camera/photo captures (e.g. Gate
// Entry's driver photo) where we know the upload should always be a small
// picture, not an arbitrary file. Keeps the generic `upload` export above
// unrestricted for other future use-cases (documents, etc).
const uploadImage = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

module.exports = upload;
module.exports.uploadImage = uploadImage;