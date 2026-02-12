const multer = require("multer");

const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
  const ok =
    file.mimetype === "text/csv" ||
    file.mimetype === "application/vnd.ms-excel" || // some browsers
    (file.originalname || "").toLowerCase().endsWith(".csv");

  if (!ok) return cb(new Error("Only CSV files are allowed."));
  cb(null, true);
}

const uploadCsv = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

module.exports = { uploadCsv };