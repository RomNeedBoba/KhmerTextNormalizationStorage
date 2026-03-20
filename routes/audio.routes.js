const express = require("express");
const router  = express.Router();

const {
  importFiles,
  updateText,
  listFiles,
  getStats,
  verifyFile,
  exportVerified,
  getAvailable,
  assignFiles,
  getMyFiles,
  getMyStatus,
  submitFile,
  streamAudio,
} = require("../controllers/audio.controller");

const { requireAuth } = require("../middleware/auth.middleware");

// All routes require a valid JWT
router.use(requireAuth);

// ── Admin ─────────────────────────────────────────────────────────
router.post(  "/import",        importFiles);    // bulk import .wav files from local folder
router.get(   "/",              listFiles);      // list all files with optional filters
router.get(   "/stats",         getStats);       // status counts across all files
router.get(   "/export",        exportVerified); // download verified files as TTS dataset
router.put(   "/:id/text",      updateText);     // attach rawText / normalizedText to a file
router.patch( "/:id/verify",    verifyFile);     // verify or reject a submitted file

// ── Student ───────────────────────────────────────────────────────
router.get(   "/available",     getAvailable);   // browse files available for assignment
router.post(  "/assign",        assignFiles);    // claim up to 10 files at once
router.get(   "/my",            getMyFiles);     // active files (assigned + submitted) with countdown
router.get(   "/my/status",     getMyStatus);    // full history — all statuses for My Status page
router.post(  "/:id/submit",    submitFile);     // submit corrected text for a file

// ── Shared ────────────────────────────────────────────────────────
router.get(   "/:id/stream",    streamAudio);    // stream .wav from disk (admin + own student files)

module.exports = router;