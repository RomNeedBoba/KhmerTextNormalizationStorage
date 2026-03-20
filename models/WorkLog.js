const mongoose = require("mongoose");

/**
 * WorkLog — one document per annotation task a student claims.
 *
 * We key on studentEmail (string) because users live in a static
 * config file, not a MongoDB collection.
 *
 * Status flow:
 *   assigned → submitted → verified   (durationHours credited)
 *                        → rejected   (durationHours = 0)
 *
 * Duration = verifiedAt − assignedAt in hours.
 * Only written when admin sets verdict = "verified".
 */
const mongoose2 = require("mongoose");

const workLogSchema = new mongoose2.Schema(
  {
    studentEmail: {
      type:      String,
      required:  true,
      lowercase: true,
      trim:      true,
      index:     true,
    },

    // Loose reference to the source task (e.g. textnorm doc _id)
    taskRef:  { type: String, default: "" },
    taskType: { type: String, default: "annotation" },

    // Student's note when submitting
    submissionNote: { type: String, default: "" },

    // Admin's note on verify / reject
    adminNote:  { type: String, default: "" },
    verifiedBy: { type: String, default: "" }, // admin email

    // Lifecycle timestamps
    assignedAt:  { type: Date, default: Date.now, index: true },
    submittedAt: { type: Date, default: null },
    verifiedAt:  { type: Date, default: null },

    // Computed on verification only — 0 until then
    durationHours: { type: Number, default: 0 },

    status: {
      type:    String,
      enum:    ["assigned", "submitted", "verified", "rejected"],
      default: "assigned",
      index:   true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose2.model("WorkLog", workLogSchema);