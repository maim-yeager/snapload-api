"use strict";

const express = require("express");
const cors    = require("cors");
const helmet  = require("helmet");
const morgan  = require("morgan");
const os      = require("os");

const routes  = require("./routes");

const PORT     = process.env.PORT     || 8080;
const HOST     = process.env.HOST     || "0.0.0.0";
const NODE_ENV = process.env.NODE_ENV || "development";

const app = express();

// Trust proxy (Fly.io / Render / Nginx)
app.set("trust proxy", 1);

// Security headers
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// CORS — allow all origins
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.options("*", cors());

// Body parsing
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Logging (skip /health to keep logs clean)
app.use(morgan("dev", { skip: (req) => req.path === "/health" }));

// Routes
app.use("/", routes);

// 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error:   `Not found: ${req.method} ${req.path}`,
    routes:  ["GET /", "GET /health", "POST /extract", "GET /download"],
  });
});

// Global error handler
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error("[error]", err.message);
  res.status(500).json({ success: false, error: err.message || "Internal server error" });
});

// Start
app.listen(PORT, HOST, () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  🎬  SnapLoad API");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  URL  : http://localhost:${PORT}`);
  console.log(`  Env  : ${NODE_ENV}`);

  // Check yt-dlp + ffmpeg
  const { getYtDlp, getFfmpeg } = require("./ytdlp");
  const ytdlp  = getYtDlp();
  const ffmpeg = getFfmpeg();
  console.log(`  yt-dlp : ${ytdlp  || "NOT FOUND ⚠"}`);
  console.log(`  ffmpeg : ${ffmpeg || "NOT FOUND ⚠"}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
});

module.exports = app;
