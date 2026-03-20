const mongoose = require("mongoose");

/**
 * AudioFile — one document per .wav file in the dataset.
 *
 * Path strategy:
 *   absolutePath  = full path on disk, used for streaming
 *   relativePath  = root-relative path, preserved for TTS export
 *                   e.g. "movie_a/chapter_3/file001.wav"
 *
 * Status flow:
 *   available → assigned → submitted → verified
 *                                    → rejected  (released back to available)
 *
 * 24h rule:
 *   If status = "assigned" and assignedAt is older than 24h,
 *   the file is auto-released back to available on next fetch.
 */
const AudioFileSchema = new mongoose.Schema(
  {
    // ── file identity ─────────────────────────────────────────
    filename:     { type: String, required: true, trim: true },
    relativePath: { type: String, required: true, trim: true }, // movie/chapter/file.wav
    absolutePath: { type: String, required: true, trim: true }, // /data/root/movie/chapter/file.wav

    // ── original text attached at import time ─────────────────
    rawText:        { type: String, default: "" },
    normalizedText: { type: String, default: "" },

    // ── student corrections (filled on submit) ────────────────
    studentRawText:        { type: String, default: "" },
    studentNormalizedText: { type: String, default: "" },

    // ── workflow ──────────────────────────────────────────────
    status: {
      type:    String,
      enum:    ["available", "assigned", "submitted", "verified", "rejected"],
      default: "available",
      index:   true,
    },

    assignedTo:  { type: String, default: null, index: true }, // student email
    assignedAt:  { type: Date,   default: null, index: true }, // used for 24h expiry check
    submittedAt: { type: Date,   default: null },
    verifiedAt:  { type: Date,   default: null },
    verifiedBy:  { type: String, default: null }, // admin email
    adminNote:   { type: String, default: "" },

    // ── folder metadata preserved for dataset export ──────────
    movieFolder:   { type: String, default: "" },
    chapterFolder: { type: String, default: "" },

    // Audio duration in seconds — read from wav header at import time
    audioDuration: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Compound indexes for efficient querying
AudioFileSchema.index({ status: 1, assignedAt: 1 });
AudioFileSchema.index({ assignedTo: 1, status: 1 });

module.exports = mongoose.model("AudioFile", AudioFileSchema);