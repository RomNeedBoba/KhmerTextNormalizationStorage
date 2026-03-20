const AudioFile = require("../models/AudioFile");
const Payment   = require("../models/Payment");
const users     = require("../config/users.config");

const RATE_PER_HOUR = 8; // USD

// All students from static config
const STUDENTS = users.filter((u) => u.role === "student");

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

function requireAdmin(req, res) {
  if (req.user?.role !== "admin") {
    res.status(403).json({ message: "Admin only." });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────
// GET /api/overview
// Admin dashboard — pulls student stats from AudioFile
// Hours = sum of audioDuration (seconds) for verified files / 3600
// ─────────────────────────────────────────────────────────────────
exports.getOverview = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    // Aggregate AudioFile — sum audioDuration for verified files per student
    const agg = await AudioFile.aggregate([
      {
        $group: {
          _id:      "$assignedTo",
          verified: { $sum: { $cond: [{ $eq: ["$status", "verified"] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
          assigned: { $sum: { $cond: [{ $eq: ["$status", "assigned"] }, 1, 0] } },
          submitted:{ $sum: { $cond: [{ $eq: ["$status", "submitted"]}, 1, 0] } },

          // Sum actual audio duration (seconds) for verified files → convert to hours
          totalHours: {
            $sum: {
              $cond: [
                { $eq: ["$status", "verified"] },
                { $divide: [{ $ifNull: ["$audioDuration", 0] }, 3600] },
                0,
              ],
            },
          },
        },
      },
    ]);

    // O(1) lookup map
    const statsMap = {};
    agg.forEach((s) => {
      if (s._id) statsMap[s._id.toLowerCase()] = s;
    });

    // Load all payment records
    const payments = await Payment.find({}).lean();
    const payMap   = {};
    payments.forEach((p) => { payMap[p.studentEmail] = p; });

    // Merge student config with aggregated stats + payment
    const students = STUDENTS.map((u) => {
      const w   = statsMap[u.email.toLowerCase()] || {};
      const pay = payMap[u.email.toLowerCase()];
      return {
        email:      u.email,
        name:       u.name || u.email,
        totalHours: w.totalHours || 0,
        verified:   w.verified   || 0,
        rejected:   w.rejected   || 0,
        assigned:   w.assigned   || 0,
        submitted:  w.submitted  || 0,
        paid:       pay?.paid    || false,
        paidAt:     pay?.paidAt  || null,
      };
    }).sort((a, b) => b.totalHours - a.totalHours || b.verified - a.verified);

    // Platform-wide totals
    const totals = {
      students:   students.length,
      totalHours: students.reduce((s, x) => s + x.totalHours, 0),
      verified:   students.reduce((s, x) => s + x.verified,   0),
      pending:    students.reduce((s, x) => s + x.submitted,  0),
      rejected:   students.reduce((s, x) => s + x.rejected,   0),
    };

    res.json({ totals, students });
  } catch (err) {
    console.error("[overview] getOverview:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// PATCH /api/overview/pay/:email
// Admin marks a student as paid or unpaid
// Body: { paid: true | false, note? }
// ─────────────────────────────────────────────────────────────────
exports.setPaid = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const email = req.params.email.toLowerCase().trim();
    const { paid, note } = req.body;

    const isStudent = STUDENTS.some((u) => u.email.toLowerCase() === email);
    if (!isStudent) {
      return res.status(400).json({ message: "No student found with that email." });
    }

    const update = {
      paid:    Boolean(paid),
      paidAt:  paid ? new Date() : null,
      paidBy:  paid ? req.user.email : "",
      note:    note || "",
    };

    const doc = await Payment.findOneAndUpdate(
      { studentEmail: email },
      { $set: update },
      { upsert: true, new: true }
    );

    res.json(doc);
  } catch (err) {
    console.error("[overview] setPaid:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// GET /api/overview/students
// Admin — all students with full stats
// ─────────────────────────────────────────────────────────────────
exports.listStudents = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const agg = await AudioFile.aggregate([
      {
        $group: {
          _id:       "$assignedTo",
          verified:  { $sum: { $cond: [{ $eq: ["$status", "verified"] }, 1, 0] } },
          rejected:  { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
          assigned:  { $sum: { $cond: [{ $eq: ["$status", "assigned"] }, 1, 0] } },
          submitted: { $sum: { $cond: [{ $eq: ["$status", "submitted"]}, 1, 0] } },
          totalHours: {
            $sum: {
              $cond: [
                { $eq: ["$status", "verified"] },
                { $divide: [{ $ifNull: ["$audioDuration", 0] }, 3600] },
                0,
              ],
            },
          },
        },
      },
    ]);

    const statsMap = {};
    agg.forEach((s) => { if (s._id) statsMap[s._id.toLowerCase()] = s; });

    const payments = await Payment.find({}).lean();
    const payMap   = {};
    payments.forEach((p) => { payMap[p.studentEmail] = p; });

    const students = STUDENTS.map((u) => {
      const w   = statsMap[u.email.toLowerCase()] || {};
      const pay = payMap[u.email.toLowerCase()];
      const verified = w.verified || 0;
      const rejected = w.rejected || 0;
      const total    = verified + rejected;
      return {
        email:      u.email,
        name:       u.name || u.email,
        totalHours: w.totalHours || 0,
        verified,
        rejected,
        assigned:   w.assigned   || 0,
        submitted:  w.submitted  || 0,
        acceptRate: total ? Math.round((verified / total) * 100) : null,
        paid:       pay?.paid || false,
        paidAt:     pay?.paidAt || null,
        payout:     (w.totalHours || 0) * RATE_PER_HOUR,
      };
    }).sort((a, b) => b.totalHours - a.totalHours);

    res.json({ students });
  } catch (err) {
    console.error("[overview] listStudents:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// Keep these stubs so overview.routes.js doesn't break
// (WorkLog routes no longer needed but kept for compatibility)
// ─────────────────────────────────────────────────────────────────
exports.assignTask   = (req, res) => res.status(410).json({ message: "Deprecated. Use /api/audio/assign instead." });
exports.submitTask   = (req, res) => res.status(410).json({ message: "Deprecated. Use /api/audio/:id/submit instead." });
exports.verifyTask   = (req, res) => res.status(410).json({ message: "Deprecated. Use /api/audio/:id/verify instead." });
exports.listWorklogs = (req, res) => res.status(410).json({ message: "Deprecated." });