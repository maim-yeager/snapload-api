"use strict";

/**
 * Routes:
 *   GET  /health          → server status
 *   POST /extract         → metadata + format list
 *   GET  /download        → download merged mp4 (video+audio) and stream to client
 */

const express = require("express");
const fs      = require("fs");
const {
  extract,
  downloadMerged,
  detectPlatform,
  getYtDlp,
  getFfmpeg,
  getCookiesFile,
} = require("./ytdlp");

const router = express.Router();

// ─── GET /health ──────────────────────────────────────────────────────────────

router.get("/health", (req, res) => {
  const ytdlp  = getYtDlp();
  const ffmpeg = getFfmpeg();

  const cookies = {
    youtube:   !!getCookiesFile("youtube"),
    instagram: !!getCookiesFile("instagram"),
    facebook:  !!getCookiesFile("facebook"),
    tiktok:    !!getCookiesFile("tiktok"),
  };

  res.json({
    success:   true,
    message:   "SnapLoad API is running",
    timestamp: new Date().toISOString(),
    yt_dlp:  { available: !!ytdlp,  path: ytdlp  || null },
    ffmpeg:  { available: !!ffmpeg, path: ffmpeg || null },
    cookies,
    supported: ["youtube", "youtube_playlist", "tiktok", "instagram", "facebook"],
  });
});

// ─── POST /extract ────────────────────────────────────────────────────────────

router.post("/extract", async (req, res) => {
  const { url } = req.body || {};

  if (!url || typeof url !== "string" || !url.trim()) {
    return res.status(400).json({
      success: false,
      error:   'Body must contain { "url": "VIDEO_URL" }',
    });
  }

  const trimmed  = url.trim();
  const platform = detectPlatform(trimmed);

  try {
    const data = await extract(trimmed);
    return res.json({ success: true, platform, data });
  } catch (err) {
    const msg = err.message || "Extraction failed";
    // Determine HTTP status based on error type
    let status = 422;
    const m = msg.toLowerCase();
    if (m.includes("private") || m.includes("login") || m.includes("sign in")) status = 403;
    else if (m.includes("not found") || m.includes("deleted") || m.includes("404")) status = 404;
    else if (m.includes("rate limit") || m.includes("429")) status = 429;
    return res.status(status).json({ success: false, platform, error: msg });
  }
});

// ─── GET /download ────────────────────────────────────────────────────────────
//
//  ?url=VIDEO_URL
//  &quality=best|360p|720p|1080p|audio   (default: best)
//
//  Downloads the video server-side, merges audio+video with ffmpeg,
//  then streams the final mp4 to the client.

router.get("/download", async (req, res) => {
  const { url, quality } = req.query;

  if (!url || typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ success: false, error: 'Missing "url" query param.' });
  }

  const validQ = ["best", "360p", "720p", "1080p", "audio"];
  const q      = validQ.includes(quality) ? quality : "best";

  console.log(`[/download] url=${url.substring(0,80)} quality=${q}`);

  let result;
  try {
    result = await downloadMerged(url.trim(), q);
  } catch (err) {
    return res.status(422).json({ success: false, error: err.message });
  }

  const { filePath, filename, mimeType, size, cleanup } = result;

  if (!fs.existsSync(filePath)) {
    return res.status(500).json({ success: false, error: "Output file missing after download." });
  }

  res.setHeader("Content-Type",        mimeType);
  res.setHeader("Content-Length",      size);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control",       "no-store");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  stream.on("end",   () => cleanup());
  stream.on("error", (e) => { console.error("[stream]", e.message); cleanup(); });
  req.on("close",    () => { stream.destroy(); cleanup(); });
});

// ─── GET / ────────────────────────────────────────────────────────────────────

router.get("/", (req, res) => {
  res.json({
    name:    "SnapLoad API",
    version: "1.0.0",
    endpoints: [
      { method: "GET",  path: "/health" },
      { method: "POST", path: "/extract",  body:  { url: "string" } },
      { method: "GET",  path: "/download", query: { url: "string", quality: "best|360p|720p|1080p|audio" } },
    ],
    supported: ["YouTube", "YouTube Playlist", "TikTok", "Instagram", "Facebook"],
  });
});

module.exports = router;
