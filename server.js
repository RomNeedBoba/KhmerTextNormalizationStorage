// const express = require("express");
// const cors = require("cors");
// const morgan = require("morgan");
// require("dotenv").config();

// const textNormRoutes = require("./routes/textNormRoutes");
// const authRoutes = require("./routes/auth.routes"); // NEW
// const { connectDB } = require("./config/db");

// const app = express();

// app.use(
//   cors({
//     origin: process.env.CORS_ORIGIN || "*",
//   })
// );

// app.use(express.json({ limit: "2mb" }));
// app.use(morgan("dev"));

// app.get("/api/health", (req, res) => res.json({ ok: true }));

// app.use("/api/auth", authRoutes); // NEW
// app.use("/api/textnorm", textNormRoutes);

// app.use((err, req, res, next) => {
//   console.error("[API Error]", err);
//   res.status(err.status || 500).json({ message: err.message || "Server error" });
// });

// const PORT = process.env.PORT || 5000;

// async function start() {
//   const MONGO_URI =
//     process.env.MONGO_URI ||
//     "mongodb+srv://cadttts_db_user:cadt12345678@ttscadt.8s2luuu.mongodb.net/";

//   await connectDB(MONGO_URI);

//   app.listen(PORT, () => {
//     console.log(`[API] Running on http://localhost:${PORT}`);
//   });
// }

// start().catch((err) => {
//   console.error("[Startup] Failed to start server:", err);
//   process.exit(1);
// });


// host
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const textNormRoutes = require("./routes/textNormRoutes");
const authRoutes = require("./routes/auth.routes");
const { connectDB } = require("./config/db");

const app = express();

// Trust proxy is important on Render/Fly/etc for rate limiting + correct IP
app.set("trust proxy", 1);

// Hide framework fingerprint
app.disable("x-powered-by");

// Basic hardening headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // allow CSV downloads
  })
);

// Logging (use dev locally; use combined in prod)
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Body size limits
app.use(express.json({ limit: process.env.JSON_LIMIT || "2mb" }));

/**
 * CORS (locked down)
 * - Supports multiple origins via comma-separated list in CORS_ORIGIN
 *   Example:
 *     CORS_ORIGIN=https://app.vercel.app,http://localhost:5173
 */
const allowedOrigins = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // allow server-to-server calls and curl (no Origin header)
      if (!origin) return cb(null, true);

      // if no CORS_ORIGIN configured, block in production
      if (allowedOrigins.length === 0) {
        if (process.env.NODE_ENV === "production") {
          return cb(new Error("CORS not configured"), false);
        }
        return cb(null, true); // allow all in dev if not configured
      }

      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
);

// Rate limiting: general + stricter for auth
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.RATE_LIMIT_PER_MIN ? Number(process.env.RATE_LIMIT_PER_MIN) : 240,
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.AUTH_RATE_LIMIT ? Number(process.env.AUTH_RATE_LIMIT) : 50,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/textnorm", apiLimiter, textNormRoutes);

// Central error handler
app.use((err, req, res, next) => {
  console.error("[API Error]", err);

  // CORS errors should be 403
  if (String(err.message || "").toLowerCase().includes("cors")) {
    return res.status(403).json({ message: err.message });
  }

  res.status(err.status || 500).json({
    message: process.env.NODE_ENV === "production" ? "Server error" : err.message,
  });
});

const PORT = process.env.PORT || 5000;

async function start() {
  // Support both names so you don't break anything
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

  if (!MONGO_URI) {
    throw new Error("Missing MONGO_URI (or MONGODB_URI) in environment variables.");
  }

  if (!process.env.JWT_SECRET) {
    throw new Error("Missing JWT_SECRET in environment variables.");
  }

  await connectDB(MONGO_URI);

  app.listen(PORT, () => {
    console.log(`[API] Running on port ${PORT} (${process.env.NODE_ENV || "development"})`);
  });
}

start().catch((err) => {
  console.error("[Startup] Failed to start server:", err);
  process.exit(1);
});