const express = require("express");
const router = express.Router();

const {
  createOne,
  bulkUploadCsv,
  list,
  updateOne,
  deleteOne,
  exportCsv,
} = require("../controllers/textNormController");

const { uploadCsv } = require("../middleware/uploadCsv");
const { requireAuth } = require("../middleware/auth.middleware"); // NEW

// Protect everything below:
router.use(requireAuth);

router.post("/", createOne);
router.post("/bulk", uploadCsv.single("file"), bulkUploadCsv);

router.get("/", list);
router.get("/export.csv", exportCsv);

router.put("/:id", updateOne);
router.delete("/:id", deleteOne);

module.exports = router;