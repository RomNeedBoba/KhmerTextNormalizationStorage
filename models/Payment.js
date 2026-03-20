const mongoose = require("mongoose");

/**
 * Payment — tracks whether a student has been paid for their work.
 * One document per student email.
 * Admin marks as paid via PATCH /api/overview/pay/:email
 */
const PaymentSchema = new mongoose.Schema(
  {
    studentEmail: { type: String, required: true, unique: true, lowercase: true, trim: true },
    paid:         { type: Boolean, default: false },
    paidAt:       { type: Date, default: null },
    paidBy:       { type: String, default: "" }, // admin email
    note:         { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Payment", PaymentSchema);