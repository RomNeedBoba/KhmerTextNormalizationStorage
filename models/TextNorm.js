const mongoose = require("mongoose");

const TEXTNORM_TYPES = [
  "CARDINAL",
  "ORDINAL",
  "DECIMAL",
  "FRACTION",
  "RANGE",
  "DATE",
  "TIME",
  "DURATION",
  "YEAR",
  "MONEY",
  "PERCENT",
  "MEASURE",
  "TELEPHONE",
  "EMAIL",
  "ID",
  "ABBREVIATION",
];

const TextNormSchema = new mongoose.Schema(
  {
    rawText: { type: String, required: true, trim: true },
    types: {
      type: [String],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: "At least one type is required",
      },
    },
    normalizedText: { type: String, required: true, trim: true },

    // Atomic Span (optional, but if provided must be complete)
    spanRawText: { type: String, trim: true, default: "" },
    spanTypes: { type: [String], default: [] },
    spanNormalizedText: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

TextNormSchema.index({ rawText: "text", normalizedText: "text" });
TextNormSchema.index({ types: 1 });
TextNormSchema.index({ spanRawText: 1 });

module.exports = {
  TextNorm: mongoose.model("TextNorm", TextNormSchema),
  TEXTNORM_TYPES,
};