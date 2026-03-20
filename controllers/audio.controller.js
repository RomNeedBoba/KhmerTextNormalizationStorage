const path      = require("path");
const fs        = require("fs");
const XLSX      = require("xlsx");
const AudioFile = require("../models/AudioFile");
const users     = require("../config/users.config");

const EXPIRE_MS   = 24 * 60 * 60 * 1000;
const MAX_PER_DAY = 10;

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

/**
 * Read audio duration in seconds from a WAV file header.
 * WAV header layout (all little-endian):
 *   Bytes 24-27 = SampleRate  (uint32)
 *   Bytes 28-31 = ByteRate    (uint32)  = SampleRate * NumChannels * BitsPerSample/8
 *   Bytes 4-7   = ChunkSize   (uint32)  = file size - 8
 *
 * Duration = (file size - 44) / ByteRate
 * Returns 0 if the file can't be read or isn't a valid WAV.
 */
function readWavDuration(filePath) {
  try {
    const buf      = Buffer.alloc(44);
    const fd       = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, 44, 0);
    fs.closeSync(fd);

    // Verify RIFF header
    if (buf.toString("ascii", 0, 4) !== "RIFF") return 0;
    if (buf.toString("ascii", 8, 12) !== "WAVE") return 0;

    const byteRate = buf.readUInt32LE(28);
    if (!byteRate) return 0;

    const fileSize = fs.statSync(filePath).size;
    return (fileSize - 44) / byteRate; // seconds
  } catch {
    return 0;
  }
}

/**
 * Release any assigned files older than 24h back to available.
 * Called inline before list/assign queries so availability is always fresh.
 */
async function expireAssignments() {
  const cutoff = new Date(Date.now() - EXPIRE_MS);
  await AudioFile.updateMany(
    { status: "assigned", assignedAt: { $lt: cutoff } },
    {
      $set: {
        status:     "available",
        assignedTo: null,
        assignedAt: null,
      },
    }
  );
}

/**
 * Read rawText / normalizedText from metadata.xlsx in a folder.
 *
 * metadata.xlsx structure (your dataset):
 *   Row 0  = headers: audio, text, normalized_text, file, samplerate, duration
 *   Row 1+ = data
 *   Column A (index 0) = audio filename WITHOUT extension  e.g. "20250814-NakFake-001"
 *   Column B (index 1) = raw text
 *   Column C (index 2) = normalized text
 *
 * Returns a Map: filenameWithoutExt → { rawText, normalizedText }
 */
function readMetadataXlsx(folderPath) {
  const map = new Map();

  // Only use metadata.xlsx — ignore transcript/transcipt files
  const xlsxPath = path.join(folderPath, "metadata.xlsx");
  if (!fs.existsSync(xlsxPath)) return map;

  try {
    const workbook  = XLSX.readFile(xlsxPath);
    const sheetName = workbook.SheetNames[0];
    const sheet     = workbook.Sheets[sheetName];
    const rows      = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // Row 0 is the header — skip it, data starts at index 1
    for (let i = 1; i < rows.length; i++) {
      const row      = rows[i];
      const audioKey = String(row[0] || "").trim(); // column A: filename without extension
      const rawText  = String(row[1] || "").trim(); // column B: text
      const normText = String(row[2] || "").trim(); // column C: normalized_text

      if (!audioKey) continue;

      map.set(audioKey, { rawText, normalizedText: normText });
    }
  } catch (err) {
    console.error("[audio] readMetadataXlsx error:", err.message);
  }

  return map;
}

/**
 * Strip extension from a wav filename to get the lookup key.
 * e.g. "20250814-NakFake-001.wav" → "20250814-NakFake-001"
 *      "HOUSE_KH_001.wav"         → "HOUSE_KH_001"
 */
function stripExtension(filename) {
  return filename.replace(/\.[^/.]+$/, "");
}

// ─────────────────────────────────────────────────────────────────
// POST /api/audio/import
// Admin — bulk import .wav files from local filesystem
// Body: { rootFolder: "/absolute/path/to/social_news" }
//
// Supports two folder structures automatically:
//   2-level: rootFolder / folder / *.wav  (your dataset)
//   3-level: rootFolder / movie / chapter / *.wav
//
// Also reads metadata.xlsx from each folder:
//   Column A (starting A2) = audio filename without extension
//   Column B (starting B2) = rawText
//   Column C (starting C2) = normalizedText
//   Matched by filename — "20250814-NakFake-001.wav" looks up "20250814-NakFake-001"
// ─────────────────────────────────────────────────────────────────
exports.importFiles = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const { rootFolder } = req.body;

    if (!rootFolder) {
      return res.status(400).json({ message: "rootFolder is required." });
    }

    if (!fs.existsSync(rootFolder)) {
      return res.status(400).json({ message: "rootFolder does not exist on disk." });
    }

    const toInsert = [];

    const topLevel = fs
      .readdirSync(rootFolder, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const folder of topLevel) {
      const folderPath = path.join(rootFolder, folder.name);
      const entries    = fs.readdirSync(folderPath, { withFileTypes: true });

      const wavFiles = entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".wav"));

      if (wavFiles.length > 0) {
        // 2-level structure: rootFolder / folder / *.wav
        const metadataMap = readMetadataXlsx(folderPath);

        for (const file of wavFiles) {
          const key          = stripExtension(file.name);
          const texts        = metadataMap.get(key) || {};
          const absolutePath = path.join(folderPath, file.name);

          toInsert.push({
            filename:       file.name,
            relativePath:   path.join(folder.name, file.name),
            absolutePath,
            movieFolder:    folder.name,
            chapterFolder:  "",
            rawText:        texts.rawText        || "",
            normalizedText: texts.normalizedText || "",
            audioDuration:  readWavDuration(absolutePath),
            status:         "available",
          });
        }
      } else {
        // 3-level structure: rootFolder / movie / chapter / *.wav
        const subDirs = entries.filter((e) => e.isDirectory());

        for (const chapter of subDirs) {
          const chapterPath     = path.join(folderPath, chapter.name);
          const metadataMap     = readMetadataXlsx(chapterPath);
          const chapterWavFiles = fs
            .readdirSync(chapterPath)
            .filter((f) => f.toLowerCase().endsWith(".wav"));

          for (const file of chapterWavFiles) {
            const key          = stripExtension(file);
            const texts        = metadataMap.get(key) || {};
            const absolutePath = path.join(chapterPath, file);

            toInsert.push({
              filename:       file,
              relativePath:   path.join(folder.name, chapter.name, file),
              absolutePath,
              movieFolder:    folder.name,
              chapterFolder:  chapter.name,
              rawText:        texts.rawText        || "",
              normalizedText: texts.normalizedText || "",
              audioDuration:  readWavDuration(absolutePath),
              status:         "available",
            });
          }
        }
      }
    }

    if (toInsert.length === 0) {
      return res.json({ inserted: 0, skipped: 0, total: 0, message: "No .wav files found." });
    }

    // Upsert — always update text + duration fields, only set path/folder on insert
    const ops = toInsert.map((doc) => ({
      updateOne: {
        filter: { relativePath: doc.relativePath },
        update: {
          $set: {
            rawText:        doc.rawText,
            normalizedText: doc.normalizedText,
            audioDuration:  doc.audioDuration,
          },
          $setOnInsert: {
            filename:      doc.filename,
            relativePath:  doc.relativePath,
            absolutePath:  doc.absolutePath,
            movieFolder:   doc.movieFolder,
            chapterFolder: doc.chapterFolder,
            status:        "available",
          },
        },
        upsert: true,
      },
    }));

    const result = await AudioFile.bulkWrite(ops, { ordered: false });

    res.json({
      inserted: result.upsertedCount,
      skipped:  toInsert.length - result.upsertedCount,
      total:    toInsert.length,
    });
  } catch (err) {
    console.error("[audio] importFiles:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// PUT /api/audio/:id/text
// Admin — attach or update rawText / normalizedText on a file
// Body: { rawText, normalizedText }
// ─────────────────────────────────────────────────────────────────
exports.updateText = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const file = await AudioFile.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          rawText:        req.body.rawText        || "",
          normalizedText: req.body.normalizedText || "",
        },
      },
      { new: true }
    );

    if (!file) return res.status(404).json({ message: "File not found." });

    res.json(file);
  } catch (err) {
    console.error("[audio] updateText:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// GET /api/audio
// Admin — list all files with optional filters (paginated)
// Query: ?status=submitted&student=email&movie=name&page=1&limit=20
// ─────────────────────────────────────────────────────────────────
exports.listFiles = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const page  = Math.max(1, parseInt(req.query.page)   || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    const filter = {};
    if (req.query.status)  filter.status      = req.query.status;
    if (req.query.student) filter.assignedTo  = req.query.student;
    if (req.query.movie)   filter.movieFolder = req.query.movie;

    const [items, total] = await Promise.all([
      AudioFile.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
      AudioFile.countDocuments(filter),
    ]);

    const nameMap = {};
    users.forEach((u) => { nameMap[u.email] = u.name || u.email; });
    items.forEach((f) => {
      f.studentName = f.assignedTo ? (nameMap[f.assignedTo] || f.assignedTo) : null;
    });

    res.json({ items, total, page, limit });
  } catch (err) {
    console.error("[audio] listFiles:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// GET /api/audio/stats
// Admin — status counts across all files
// ─────────────────────────────────────────────────────────────────
exports.getStats = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const counts = await AudioFile.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const stats = { available: 0, assigned: 0, submitted: 0, verified: 0, rejected: 0 };
    counts.forEach((c) => { stats[c._id] = c.count; });
    stats.total = Object.values(stats).reduce((a, b) => a + b, 0);

    res.json(stats);
  } catch (err) {
    console.error("[audio] getStats:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// PATCH /api/audio/:id/verify
// Admin — verify or reject a submitted file
// Body: { verdict: "verified" | "rejected", adminNote? }
// ─────────────────────────────────────────────────────────────────
exports.verifyFile = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const { verdict, adminNote } = req.body;

    if (!["verified", "rejected"].includes(verdict)) {
      return res.status(400).json({ message: "verdict must be 'verified' or 'rejected'." });
    }

    const file = await AudioFile.findById(req.params.id);
    if (!file) return res.status(404).json({ message: "File not found." });

    if (file.status !== "submitted") {
      return res.status(400).json({
        message: `File must be submitted before verification. Current status: "${file.status}".`,
      });
    }

    if (verdict === "verified") {
      file.status     = "verified";
      file.verifiedAt = new Date();
      file.verifiedBy = req.user.email;
      file.adminNote  = adminNote || "";
    } else {
      file.status                = "available";
      file.assignedTo            = null;
      file.assignedAt            = null;
      file.submittedAt           = null;
      file.studentRawText        = "";
      file.studentNormalizedText = "";
      file.adminNote             = adminNote || "";
    }

    await file.save();
    res.json(file);
  } catch (err) {
    console.error("[audio] verifyFile:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// GET /api/audio/export
// Admin — download all verified files as a TTS-ready dataset
// Query: ?format=json (default) | csv
// ─────────────────────────────────────────────────────────────────
exports.exportVerified = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const format = req.query.format || "json";

    const files = await AudioFile.find({ status: "verified" })
      .sort({ movieFolder: 1, chapterFolder: 1, filename: 1 })
      .lean();

    const rows = files.map((f) => ({
      id:                  f._id,
      filename:            f.filename,
      relativePath:        f.relativePath,
      folder:              f.movieFolder,
      chapterFolder:       f.chapterFolder,
      originalRawText:     f.rawText,
      originalNormalized:  f.normalizedText,
      correctedRawText:    f.studentRawText,
      correctedNormalized: f.studentNormalizedText,
      verifiedBy:          f.verifiedBy,
      verifiedAt:          f.verifiedAt,
    }));

    if (format === "csv") {
      const headers = Object.keys(rows[0] || {}).join(",");
      const csvRows = rows.map((r) =>
        Object.values(r)
          .map((v) => `"${String(v || "").replace(/"/g, '""')}"`)
          .join(",")
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="tts_dataset_${Date.now()}.csv"`);
      return res.send([headers, ...csvRows].join("\n"));
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="tts_dataset_${Date.now()}.json"`);
    res.json(rows);
  } catch (err) {
    console.error("[audio] exportVerified:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// GET /api/audio/available
// Student — browse files available for assignment
// Query: ?q=search&limit=200
// Returns all files in one request (no pagination) for infinite scroll.
// ─────────────────────────────────────────────────────────────────
exports.getAvailable = async (req, res) => {
  try {
    await expireAssignments();

    const limit = Math.min(500, parseInt(req.query.limit) || 200);
    const q     = String(req.query.q || "").trim();

    const filter = { status: "available" };

    if (q) {
      const re  = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { filename:      re },
        { rawText:       re },
        { normalizedText:re },
        { movieFolder:   re },
      ];
    }

    const [items, total] = await Promise.all([
      AudioFile.find(filter)
        .select("filename relativePath rawText normalizedText movieFolder chapterFolder createdAt")
        .sort({ movieFolder: 1, filename: 1 })
        .limit(limit)
        .lean(),
      AudioFile.countDocuments(filter),
    ]);

    res.json({ items, total });
  } catch (err) {
    console.error("[audio] getAvailable:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// POST /api/audio/assign
// Student — claim up to 10 files at once
// Body: { fileIds: ["id1", "id2", ...] }
// ─────────────────────────────────────────────────────────────────
exports.assignFiles = async (req, res) => {
  try {
    await expireAssignments();

    const studentEmail = req.user.email;
    const { fileIds }  = req.body;

    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ message: "fileIds array is required." });
    }

    if (fileIds.length > MAX_PER_DAY) {
      return res.status(400).json({ message: `You can assign at most ${MAX_PER_DAY} files at once.` });
    }

    const currentCount = await AudioFile.countDocuments({
      assignedTo: studentEmail,
      status:     { $in: ["assigned", "submitted"] },
    });

    const slots = MAX_PER_DAY - currentCount;

    if (slots <= 0) {
      return res.status(400).json({
        message: `You already have ${currentCount} active files. Complete them before taking more.`,
      });
    }

    const toAssign = fileIds.slice(0, slots);
    const now      = new Date();
    const assigned = [];

    for (const id of toAssign) {
      const updated = await AudioFile.findOneAndUpdate(
        { _id: id, status: "available" },
        { $set: { status: "assigned", assignedTo: studentEmail, assignedAt: now } },
        { new: true }
      );
      if (updated) assigned.push(updated);
    }

    res.json({
      assigned: assigned.length,
      skipped:  toAssign.length - assigned.length,
      files:    assigned,
    });
  } catch (err) {
    console.error("[audio] assignFiles:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// GET /api/audio/my
// Student — get own active files (assigned + submitted) with countdown
// ─────────────────────────────────────────────────────────────────
exports.getMyFiles = async (req, res) => {
  try {
    await expireAssignments();

    const files = await AudioFile.find({
      assignedTo: req.user.email,
      status:     { $in: ["assigned", "submitted"] },
    })
      .sort({ assignedAt: 1 })
      .lean();

    const now = Date.now();
    const enriched = files.map((f) => ({
      ...f,
      expiresIn: f.assignedAt
        ? Math.max(0, EXPIRE_MS - (now - new Date(f.assignedAt).getTime()))
        : null,
    }));

    res.json({ files: enriched });
  } catch (err) {
    console.error("[audio] getMyFiles:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// GET /api/audio/my/status
// Student — full history: all statuses for My Status page
// ─────────────────────────────────────────────────────────────────
exports.getMyStatus = async (req, res) => {
  try {
    await expireAssignments();

    const studentEmail = req.user.email;
    const now          = Date.now();

    const files = await AudioFile.find({ assignedTo: studentEmail })
      .sort({ updatedAt: -1 })
      .lean();

    const counts = { assigned: 0, submitted: 0, verified: 0, rejected: 0 };
    files.forEach((f) => {
      if (counts[f.status] !== undefined) counts[f.status]++;
    });

    const enriched = files.map((f) => ({
      ...f,
      expiresIn: f.status === "assigned" && f.assignedAt
        ? Math.max(0, EXPIRE_MS - (now - new Date(f.assignedAt).getTime()))
        : null,
    }));

    res.json({ counts, files: enriched });
  } catch (err) {
    console.error("[audio] getMyStatus:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// POST /api/audio/:id/submit
// Student — submit corrected text for a file
// Body: { studentRawText, studentNormalizedText }
// ─────────────────────────────────────────────────────────────────
exports.submitFile = async (req, res) => {
  try {
    const { studentRawText, studentNormalizedText } = req.body;
    const studentEmail = req.user.email;

    if (!studentRawText?.trim() || !studentNormalizedText?.trim()) {
      return res.status(400).json({ message: "Both studentRawText and studentNormalizedText are required." });
    }

    const file = await AudioFile.findOne({ _id: req.params.id, assignedTo: studentEmail });

    if (!file) {
      return res.status(404).json({ message: "File not found or not assigned to you." });
    }

    if (file.status !== "assigned") {
      return res.status(400).json({ message: `Cannot submit — current status is "${file.status}".` });
    }

    if (Date.now() - new Date(file.assignedAt).getTime() > EXPIRE_MS) {
      file.status     = "available";
      file.assignedTo = null;
      file.assignedAt = null;
      await file.save();
      return res.status(400).json({ message: "Your assignment expired. The file has been released." });
    }

    file.status                = "submitted";
    file.submittedAt           = new Date();
    file.studentRawText        = studentRawText.trim();
    file.studentNormalizedText = studentNormalizedText.trim();
    await file.save();

    res.json(file);
  } catch (err) {
    console.error("[audio] submitFile:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────
// GET /api/audio/:id/stream
// Shared — stream a .wav file from local disk
// Supports Range requests so the browser <audio> element can seek.
// No auth header needed — ownership checked via DB status/assignedTo.
// ─────────────────────────────────────────────────────────────────
exports.streamAudio = async (req, res) => {
  try {
    const file = await AudioFile.findById(req.params.id)
      .select("absolutePath filename status assignedTo")
      .lean();

    if (!file) return res.status(404).json({ message: "File not found." });

    if (req.user?.role !== "admin") {
      const allowed =
        file.status === "available" ||
        file.assignedTo === req.user.email;

      if (!allowed) {
        return res.status(403).json({ message: "Not authorized to stream this file." });
      }
    }

    if (!fs.existsSync(file.absolutePath)) {
      return res.status(404).json({ message: "Audio file not found on disk." });
    }

    const stat     = fs.statSync(file.absolutePath);
    const fileSize = stat.size;
    const range    = req.headers.range;

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
      const start = parseInt(startStr, 10);
      const end   = endStr ? parseInt(endStr, 10) : fileSize - 1;
      const chunk = end - start + 1;

      res.writeHead(206, {
        "Content-Range":  `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges":  "bytes",
        "Content-Length": chunk,
        "Content-Type":   "audio/wav",
      });

      fs.createReadStream(file.absolutePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type":   "audio/wav",
        "Accept-Ranges":  "bytes",
      });

      fs.createReadStream(file.absolutePath).pipe(res);
    }
  } catch (err) {
    console.error("[audio] streamAudio:", err);
    res.status(500).json({ message: err.message });
  }
};