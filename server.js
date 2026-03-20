require("dotenv").config();

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const textNormRoutes = require("./routes/textNormRoutes");
const authRoutes     = require("./routes/auth.routes");
const overviewRoutes = require("./routes/overview.routes");
const audioRoutes    = require("./routes/audio.routes"); // ✅ NEW

const { connectDB } = require("./config/db");

const app = express();

/**
 * =========================
 * 🔐 SECURITY
 * =========================
 */
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

/**
 * =========================
 * 📊 LOGGING
 * =========================
 */
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

/**
 * =========================
 * 📦 BODY PARSER
 * =========================
 */
app.use(express.json({ limit: process.env.JSON_LIMIT || "2mb" }));

/**
 * =========================
 * 🌐 CORS
 * =========================
 */
const allowedOrigins = String(
  process.env.CORS_ORIGIN || "http://localhost:5173"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      console.log("Incoming Origin:", origin);

      // Allow Postman / curl
      if (!origin) return cb(null, true);

      if (allowedOrigins.includes(origin)) {
        return cb(null, true);
      }

      // ❗ DO NOT THROW ERROR
      return cb(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    maxAge: 86400,
  })
);

/**
 * =========================
 * 🚦 RATE LIMITING
 * =========================
 */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.RATE_LIMIT_PER_MIN
    ? Number(process.env.RATE_LIMIT_PER_MIN)
    : 240,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.AUTH_RATE_LIMIT
    ? Number(process.env.AUTH_RATE_LIMIT)
    : 50,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
});

/**
 * =========================
 * 🩺 HEALTH CHECK
 * =========================
 */
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

/**
 * =========================
 * 🚀 ROUTES
 * =========================
 */
app.use("/api/auth",     authLimiter, authRoutes);
app.use("/api/textnorm", apiLimiter,  textNormRoutes);
app.use("/api/overview", apiLimiter,  overviewRoutes);
app.use("/api/audio",    apiLimiter,  audioRoutes); // ✅ NEW

/**
 * =========================
 * ❌ ERROR HANDLER
 * =========================
 */
app.use((err, req, res, next) => {
  console.error("[API Error]", err);

  res.status(err.status || 500).json({
    message:
      process.env.NODE_ENV === "production"
        ? "Server error"
        : err.message,
  });
});

/**
 * =========================
 * 🟢 START SERVER
 * =========================
 */
const PORT = process.env.PORT || 5000;

async function start() {
  const MONGO_URI = process.env.MONGODB_URI;

  if (!MONGO_URI) {
    throw new Error("Missing MONGODB_URI in environment variables");
  }

  if (!process.env.JWT_SECRET) {
    throw new Error("Missing JWT_SECRET");
  }

  await connectDB(MONGO_URI);

  app.listen(PORT, () => {
    console.log(
      `[API] Running on port ${PORT} (${process.env.NODE_ENV || "development"})`
    );
  });
}

start().catch((err) => {
  console.error("[Startup Error]", err);
  process.exit(1);
});