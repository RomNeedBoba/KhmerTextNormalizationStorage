const mongoose = require("mongoose");

async function connectDB(mongoUri) {
  try {
    mongoose.set("strictQuery", true);

    await mongoose.connect(mongoUri, {
      // modern mongoose generally doesn't require extra options,
      // but it's fine to keep connection centralized here
    });

    const conn = mongoose.connection;
    console.log(`[MongoDB] Connected: ${conn.host}/${conn.name}`);

    conn.on("error", (err) => {
      console.error("[MongoDB] Connection error:", err);
    });

    conn.on("disconnected", () => {
      console.warn("[MongoDB] Disconnected");
    });

    return conn;
  } catch (err) {
    console.error("[MongoDB] Initial connection failed:", err);
    throw err;
  }
}

module.exports = { connectDB };
