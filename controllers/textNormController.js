const csvParser = require("csv-parser");
const { Readable } = require("stream");
const mongoose = require("mongoose");
const { TextNorm, TEXTNORM_TYPES } = require("../models/TextNorm");

function cleanText(s) {
  if (s == null) return "";
  // normalize line breaks then collapse whitespace
  return String(s)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function assertValidTypes(types) {
  if (!Array.isArray(types) || types.length === 0) {
    const err = new Error("At least one type must be selected.");
    err.status = 400;
    throw err;
  }

  for (const t of types) {
    if (!TEXTNORM_TYPES.includes(t)) {
      const err = new Error(`Invalid type: ${t}`);
      err.status = 400;
      throw err;
    }
  }
}

function splitTypesPipe(s) {
  return String(s || "")
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);
}

// Span is optional, but if spanRawText is provided then spanTypes + spanNormalizedText are required.
function assertSpanIfProvided({ spanRawText, spanTypes, spanNormalizedText }) {
  const sr = cleanText(spanRawText || "");
  if (!sr) return;

  const sn = cleanText(spanNormalizedText || "");
  const st = Array.isArray(spanTypes) ? spanTypes : [];

  if (!sn) {
    const err = new Error("Span Normalized Text is required when Span Raw Text is provided.");
    err.status = 400;
    throw err;
  }

  if (st.length === 0) {
    const err = new Error("Select at least one Span Type when Span Raw Text is provided.");
    err.status = 400;
    throw err;
  }

  assertValidTypes(st);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

exports.createOne = async (req, res) => {
  try {
    const { rawText, normalizedText, types } = req.body;

    const spanRawText = req.body.spanRawText;
    const spanTypes = req.body.spanTypes;
    const spanNormalizedText = req.body.spanNormalizedText;

    if (!cleanText(rawText)) return res.status(400).json({ message: "Raw Text is required." });
    if (!cleanText(normalizedText))
      return res.status(400).json({ message: "Normalized Text is required." });

    assertValidTypes(types);
    assertSpanIfProvided({ spanRawText, spanTypes, spanNormalizedText });

    const doc = await TextNorm.create({
      rawText: cleanText(rawText),
      normalizedText: cleanText(normalizedText),
      types,

      spanRawText: cleanText(spanRawText),
      spanTypes: Array.isArray(spanTypes) ? spanTypes : [],
      spanNormalizedText: cleanText(spanNormalizedText),
    });

    res.status(201).json(doc);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message || "Bad request" });
  }
};

exports.bulkUploadCsv = async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ message: "CSV file is required (field name: file)." });
    }

    const rows = [];
    const stream = Readable.from(req.file.buffer);

    await new Promise((resolve, reject) => {
      stream
        .pipe(csvParser({ separator: ",", skipLines: 0 }))
        .on("data", (data) => rows.push(data))
        .on("end", resolve)
        .on("error", reject);
    });

    // New CSV format:
    // raw_text,type,normtext,span_raw,span_type,span_norm
    const docs = [];
    for (const r of rows) {
      const raw = cleanText(r.raw_text);
      const norm = cleanText(r.normtext);

      const types = splitTypesPipe(r.type);

      const spanRawText = cleanText(r.span_raw);
      const spanNormalizedText = cleanText(r.span_norm);
      const spanTypes = splitTypesPipe(r.span_type);

      if (!raw && !norm) continue;

      // sentence required
      if (!raw || !norm) continue;

      // sentence types required
      try {
        assertValidTypes(types);
      } catch {
        continue;
      }

      // span optional but must be complete if provided
      try {
        assertSpanIfProvided({ spanRawText, spanTypes, spanNormalizedText });
      } catch {
        continue;
      }

      docs.push({
        rawText: raw,
        normalizedText: norm,
        types,
        spanRawText,
        spanNormalizedText,
        spanTypes: spanRawText ? spanTypes : [],
      });
    }

    if (docs.length === 0) {
      return res.status(400).json({ message: "No valid rows found in CSV." });
    }

    const inserted = await TextNorm.insertMany(docs, { ordered: false });

    res.status(201).json({
      insertedCount: inserted.length,
      previewCount: docs.length,
    });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message || "Bulk upload failed" });
  }
};

exports.list = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 100);
    const skip = (page - 1) * limit;

    const q = cleanText(req.query.q || "");

    let types = req.query.types;
    if (typeof types === "string") types = [types];
    if (!Array.isArray(types)) types = [];

    const filter = {};
    if (types.length > 0) {
      assertValidTypes(types);
      filter.types = { $in: types };
    }

    if (q) {
      const re = new RegExp(escapeRegex(q), "i");
      filter.$or = [
        { rawText: re },
        { normalizedText: re },
        { spanRawText: re },
        { spanNormalizedText: re },
      ];
    }

    const [items, total] = await Promise.all([
      TextNorm.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      TextNorm.countDocuments(filter),
    ]);

    res.json({
      items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message || "Failed to list items" });
  }
};

exports.updateOne = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid id" });
    }

    const patch = {};

    if (req.body.rawText !== undefined) patch.rawText = cleanText(req.body.rawText);
    if (req.body.normalizedText !== undefined)
      patch.normalizedText = cleanText(req.body.normalizedText);
    if (req.body.types !== undefined) {
      assertValidTypes(req.body.types);
      patch.types = req.body.types;
    }

    if (req.body.spanRawText !== undefined) patch.spanRawText = cleanText(req.body.spanRawText);
    if (req.body.spanNormalizedText !== undefined)
      patch.spanNormalizedText = cleanText(req.body.spanNormalizedText);
    if (req.body.spanTypes !== undefined) {
      if (!Array.isArray(req.body.spanTypes)) {
        return res.status(400).json({ message: "spanTypes must be an array." });
      }
      patch.spanTypes = req.body.spanTypes;
    }

    if (patch.rawText !== undefined && !patch.rawText) {
      return res.status(400).json({ message: "Raw Text is required." });
    }
    if (patch.normalizedText !== undefined && !patch.normalizedText) {
      return res.status(400).json({ message: "Normalized Text is required." });
    }

    // Validate span rule based on final state (existing + patch)
    const existing = await TextNorm.findById(id);
    if (!existing) return res.status(404).json({ message: "Not found" });

    const mergedSpan = {
      spanRawText: patch.spanRawText !== undefined ? patch.spanRawText : existing.spanRawText,
      spanNormalizedText:
        patch.spanNormalizedText !== undefined
          ? patch.spanNormalizedText
          : existing.spanNormalizedText,
      spanTypes: patch.spanTypes !== undefined ? patch.spanTypes : existing.spanTypes,
    };

    assertSpanIfProvided(mergedSpan);

    const updated = await TextNorm.findByIdAndUpdate(id, patch, { new: true });

    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message || "Update failed" });
  }
};

exports.deleteOne = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid id" });
    }

    const deleted = await TextNorm.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: "Not found" });

    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message || "Delete failed" });
  }
};

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

exports.exportCsv = async (req, res) => {
  try {
    const q = cleanText(req.query.q || "");

    let types = req.query.types;
    if (typeof types === "string") types = [types];
    if (!Array.isArray(types)) types = [];

    const includeSpan = String(req.query.includeSpan || "") === "1";

    const filter = {};
    if (types.length > 0) {
      assertValidTypes(types);
      filter.types = { $in: types };
    }

    if (q) {
      const re = new RegExp(escapeRegex(q), "i");
      filter.$or = [
        { rawText: re },
        { normalizedText: re },
        { spanRawText: re },
        { spanNormalizedText: re },
      ];
    }

    const items = await TextNorm.find(filter).sort({ createdAt: -1 });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="khmer_text_normalization_tts.csv"'
    );

    if (!includeSpan) {
      res.write("id,raw_text,types,normalized_text\n");
    } else {
      res.write("id,raw_text,types,normalized_text,span_raw,span_types,span_normalized\n");
    }

    for (let i = 0; i < items.length; i++) {
      const doc = items[i];
      const id = String(i + 1).padStart(3, "0");

      const typesStr = Array.isArray(doc.types) ? doc.types.join("|") : "";
      const spanTypesStr = Array.isArray(doc.spanTypes) ? doc.spanTypes.join("|") : "";

      const baseCols = [
        csvEscape(id),
        csvEscape(doc.rawText),
        csvEscape(typesStr),
        csvEscape(doc.normalizedText),
      ];

      const cols = includeSpan
        ? baseCols.concat([
            csvEscape(doc.spanRawText || ""),
            csvEscape(spanTypesStr),
            csvEscape(doc.spanNormalizedText || ""),
          ])
        : baseCols;

      res.write(cols.join(",") + "\n");
    }

    res.end();
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message || "Export failed" });
  }
};