"use strict";

/**
 * yt-dlp wrapper
 *
 * extract()        → metadata + download URLs (fast, no file download)
 * downloadMerged() → downloads video+audio, merges with ffmpeg → streams file
 */

const { spawn, spawnSync } = require("child_process");
const path   = require("path");
const fs     = require("fs");
const os     = require("os");
const crypto = require("crypto");

// ─── Tmp directory for merged files ──────────────────────────────────────────
const TMP_DIR = path.join(os.tmpdir(), "snapload");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ─── Cookies directory ────────────────────────────────────────────────────────
// Place platform cookies files here:
//   cookies/youtube.txt
//   cookies/instagram.txt
//   cookies/facebook.txt
//   cookies/tiktok.txt
//
// Format: Netscape/Mozilla cookies.txt (exported from browser extension)
// Extension: "Get cookies.txt LOCALLY" (Chrome/Firefox)
const COOKIES_DIR = path.join(process.cwd(), "cookies");

function getCookiesFile(platform) {
  const map = {
    youtube:          "youtube.txt",
    youtube_playlist: "youtube.txt",
    instagram:        "instagram.txt",
    facebook:         "facebook.txt",
    tiktok:           "tiktok.txt",
  };
  const filename = map[platform];
  if (!filename) return null;
  const filepath = path.join(COOKIES_DIR, filename);
  return fs.existsSync(filepath) ? filepath : null;
}

// ─── Resolve binaries ─────────────────────────────────────────────────────────

function resolveBin(name) {
  // 1. System PATH
  try {
    const r = spawnSync("which", [name], { stdio: "pipe" });
    if (r.status === 0) {
      const p = r.stdout.toString().trim();
      if (p) return p;
    }
  } catch (_) {}

  // 2. Common install paths
  const paths = [
    `/usr/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    path.join(process.cwd(), "bin", name),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getYtDlp()  { return resolveBin("yt-dlp"); }
function getFfmpeg() { return resolveBin("ffmpeg"); }

// ─── Platform detection ───────────────────────────────────────────────────────

function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes("tiktok.com") || u.includes("vm.tiktok.com")) return "tiktok";
  if (u.includes("instagram.com"))                              return "instagram";
  if (u.includes("facebook.com") || u.includes("fb.watch") || u.includes("fb.com")) return "facebook";
  if (u.includes("youtube.com") || u.includes("youtu.be") || u.includes("youtube-nocookie.com")) {
    return u.includes("list=") ? "youtube_playlist" : "youtube";
  }
  return "unknown";
}

function validateUrl(url) {
  try {
    const p = new URL(url);
    return ["http:", "https:"].includes(p.protocol);
  } catch (_) { return false; }
}

// ─── Common base args ─────────────────────────────────────────────────────────

const BASE = [
  "--no-playlist",
  "--no-warnings",
  "--geo-bypass",
  "--geo-bypass-country", "US",
  "--socket-timeout",     "30",
  "--retries",            "8",
  "--fragment-retries",   "8",
  "--concurrent-fragments", "4",
  "--add-header", "Accept-Language:en-US,en;q=0.9",
  "--add-header", "Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
];

// ─── Per-platform extra args ──────────────────────────────────────────────────

function platformArgs(platform) {
  switch (platform) {
    case "youtube":
      return [
        "--extractor-args", "youtube:player_client=android,ios,web",
        "--add-header", "User-Agent:com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip",
      ];

    case "tiktok":
      return [
        "--extractor-args", "tiktok:api_hostname=api16-normal-c-useast1a.tiktokv.com",
        "--add-header", "User-Agent:com.zhiliaoapp.musically/2022600030 (Linux; U; Android 12; en_US; Pixel 6; Build/SD1A.210817.036; Cronet/58.0.2991.0)",
        "--add-header", "Referer:https://www.tiktok.com/",
      ];

    case "instagram":
      return [
        "--add-header", "User-Agent:Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "--add-header", "Referer:https://www.instagram.com/",
        "--add-header", "X-IG-App-ID:936619743392459",
        "--add-header", "X-ASBD-ID:129477",
      ];

    case "facebook":
      return [
        "--add-header", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "--add-header", "Referer:https://www.facebook.com/",
        "--add-header", "sec-fetch-site:same-origin",
      ];

    default:
      return [];
  }
}

// ─── Format selectors ─────────────────────────────────────────────────────────
// Order matters — yt-dlp picks the first one that works

const FORMAT_BEST = [
  // H264 video + AAC audio → best browser/device compatibility
  "bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]",
  "bestvideo[vcodec^=avc][ext=mp4]+bestaudio[ext=m4a]",
  "bestvideo[ext=mp4]+bestaudio[ext=m4a]",
  "bestvideo[ext=mp4]+bestaudio",
  "bestvideo+bestaudio[ext=m4a]",
  "bestvideo+bestaudio",
  // Pre-merged fallbacks
  "best[ext=mp4]",
  "best",
].join("/");

function getFormat(quality) {
  switch (quality) {
    case "360p":
      return [
        "bestvideo[height<=360][vcodec^=avc][ext=mp4]+bestaudio[ext=m4a]",
        "bestvideo[height<=360][ext=mp4]+bestaudio",
        "bestvideo[height<=360]+bestaudio",
        "best[height<=360][ext=mp4]",
        "best[height<=360]",
        "best",
      ].join("/");

    case "720p":
      return [
        "bestvideo[height<=720][vcodec^=avc][ext=mp4]+bestaudio[ext=m4a]",
        "bestvideo[height<=720][ext=mp4]+bestaudio",
        "bestvideo[height<=720]+bestaudio",
        "best[height<=720][ext=mp4]",
        "best[height<=720]",
        "best",
      ].join("/");

    case "1080p":
      return [
        "bestvideo[height<=1080][vcodec^=avc][ext=mp4]+bestaudio[ext=m4a]",
        "bestvideo[height<=1080][ext=mp4]+bestaudio",
        "bestvideo[height<=1080]+bestaudio",
        "best[height<=1080][ext=mp4]",
        "best[height<=1080]",
        "best",
      ].join("/");

    case "audio":
      return "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio";

    default:
      return FORMAT_BEST;
  }
}

// ─── Error parser ─────────────────────────────────────────────────────────────

function parseError(stderr, stdout) {
  const raw = (stderr || stdout || "").trim();
  const t   = raw.toLowerCase();

  if (t.includes("unsupported url"))
    return "Unsupported URL. Paste a direct video/reel/post link.";
  if (t.includes("private video") || t.includes("this video is private"))
    return "This video is private.";
  if ((t.includes("login") || t.includes("sign in")) && (t.includes("required") || t.includes("to view")))
    return "This content requires login. Private or restricted content cannot be downloaded.";
  if (t.includes("age") && (t.includes("restrict") || t.includes("limit")))
    return "Age-restricted content — cannot download without login.";
  if (t.includes("429") || t.includes("too many requests"))
    return "Rate limited by the platform. Wait a few minutes and retry.";
  if (t.includes("404") || (t.includes("not found") && !t.includes("ffmpeg")))
    return "Video not found — it may have been deleted or the link is broken.";
  if (t.includes("403") || t.includes("forbidden"))
    return "Access denied. The platform blocked this request.";
  if (t.includes("removed") || t.includes("deleted") || t.includes("no longer available"))
    return "This content has been removed or deleted.";
  if (t.includes("not available in your country") || (t.includes("geo") && t.includes("block")))
    return "Geo-restricted content — not available from the server's location.";
  if (t.includes("instagram") && (t.includes("not available") || t.includes("sorry")))
    return "Instagram blocked this request. Try a different link, or the content may require login.";
  if (t.includes("timed out") || t.includes("timeout"))
    return "The request timed out. The video may be too large or the server is slow.";

  // Return first meaningful line from yt-dlp output
  const line = raw
    .split("\n")
    .map(l => l.trim())
    .find(l => l && !l.startsWith("WARNING") && !l.startsWith("[debug]") && !l.startsWith("NOTE"));

  return (line || "Unknown extraction error").substring(0, 400);
}

// ─── Core spawn wrapper ───────────────────────────────────────────────────────

function runYtDlp(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const proc = spawn(bin, args, {
      shell: false,
      env:   { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
    });

    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", d => { stdout += d; });
    proc.stderr.on("data", d => { stderr += d; });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject({ stderr: "Extraction timed out.", stdout: "" });
    }, timeoutMs);

    proc.on("close", code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject({ stderr, stdout });
    });

    proc.on("error", err => {
      clearTimeout(timer);
      reject({ stderr: err.message, stdout: "" });
    });
  });
}

// ─── 1. extract() — metadata only (fast) ─────────────────────────────────────

async function extract(url) {
  if (!validateUrl(url)) throw new Error("Invalid URL.");

  const platform = detectPlatform(url);
  const bin      = getYtDlp();
  if (!bin) throw new Error("yt-dlp is not installed on the server.");

  // Playlist
  if (platform === "youtube_playlist") {
    const args = [
      "--yes-playlist", "--flat-playlist", "--dump-single-json",
      "--no-warnings", "--quiet", "--geo-bypass", "--socket-timeout", "30",
      url,
    ];
    try {
      const out = await runYtDlp(bin, args, 60_000);
      return formatPlaylist(JSON.parse(out.trim()));
    } catch (e) {
      throw new Error(parseError(e.stderr, e.stdout));
    }
  }

  const cookiesFile = getCookiesFile(platform);
  const cookiesArgs = cookiesFile ? ["--cookies", cookiesFile] : [];
  if (cookiesFile) console.log(`[extract] Using cookies: ${cookiesFile}`);

  const args = [
    ...BASE,
    "--dump-json",
    "--quiet",
    ...platformArgs(platform),
    ...cookiesArgs,
    url,
  ];

  try {
    const out   = await runYtDlp(bin, args, 90_000);
    const lines = out.trim().split("\n").filter(Boolean);
    const raw   = JSON.parse(lines[lines.length - 1]);
    return formatMeta(raw, platform);
  } catch (e) {
    throw new Error(parseError(e.stderr, e.stdout));
  }
}

// ─── 2. downloadMerged() — download + merge → temp file ──────────────────────

async function downloadMerged(url, quality) {
  if (!validateUrl(url)) throw new Error("Invalid URL.");

  const platform = detectPlatform(url);
  const bin      = getYtDlp();
  if (!bin) throw new Error("yt-dlp is not installed on the server.");

  const ffmpeg  = getFfmpeg();
  const id      = crypto.randomBytes(12).toString("hex");
  const outTpl  = path.join(TMP_DIR, `${id}.%(ext)s`);
  const fmt     = getFormat(quality || "best");

  const args = [
    ...BASE,
    "--format",       fmt,
    "--output",       outTpl,
    "--print",        "after_move:filepath",
    "--no-simulate",
    "--quiet",
  ];

  // ffmpeg merge
  if (ffmpeg) {
    args.push("--ffmpeg-location", ffmpeg);
    args.push("--merge-output-format", "mp4");
    // Re-encode audio to AAC for max compatibility
    if (quality !== "audio") {
      args.push("--postprocessor-args", "ffmpeg:-c:v copy -c:a aac -b:a 192k");
    }
  } else {
    // No ffmpeg — force pre-merged single file
    args[args.indexOf("--format") + 1] =
      "best[ext=mp4]/best[vcodec^=avc1]/best[vcodec^=avc]/best";
  }

  const cookiesFile = getCookiesFile(platform);
  if (cookiesFile) {
    args.push("--cookies", cookiesFile);
    console.log(`[download] Using cookies: ${cookiesFile}`);
  }

  args.push(...platformArgs(platform), url);

  console.log(`[download] ${platform} | quality=${quality || "best"} | ffmpeg=${!!ffmpeg}`);

  try {
    const out   = await runYtDlp(bin, args, 600_000); // 10 min timeout
    const lines = out.trim().split("\n").filter(Boolean);
    let filePath = lines[lines.length - 1].trim();

    // Fallback: scan tmp dir
    if (!filePath || !fs.existsSync(filePath)) {
      const found = fs.readdirSync(TMP_DIR)
        .filter(f => f.startsWith(id))
        .map(f => path.join(TMP_DIR, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      if (!found.length) throw new Error("Download finished but output file not found.");
      filePath = found[0];
    }

    const ext     = path.extname(filePath).replace(".", "") || "mp4";
    const isAudio = quality === "audio";
    const mime    = isAudio ? "audio/mp4" : "video/mp4";
    const size    = fs.statSync(filePath).size;

    console.log(`[download] Done: ${path.basename(filePath)} (${(size/1e6).toFixed(1)} MB)`);

    return {
      filePath,
      filename: `snapload.${ext}`,
      mimeType: mime,
      size,
      cleanup: () => {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
      },
    };
  } catch (e) {
    throw new Error(parseError(e.stderr, e.stdout));
  }
}

// ─── Response formatters ──────────────────────────────────────────────────────

function formatMeta(raw, platform) {
  const formats = (raw.formats || [])
    .filter(f => f.url && (f.vcodec !== "none" || f.acodec !== "none"))
    .map(f => ({
      format_id:  f.format_id,
      ext:        f.ext,
      quality:    f.quality,
      resolution: f.resolution || (f.height ? `${f.width || "?"}x${f.height}` : null),
      fps:        f.fps    || null,
      filesize:   f.filesize || f.filesize_approx || null,
      vcodec:     f.vcodec !== "none" ? f.vcodec : null,
      acodec:     f.acodec !== "none" ? f.acodec : null,
      url:        f.url,
      has_video:  !!(f.vcodec && f.vcodec !== "none"),
      has_audio:  !!(f.acodec && f.acodec !== "none"),
    }))
    .sort((a, b) => (b.quality || 0) - (a.quality || 0));

  const bestCombined = formats.find(f => f.has_video && f.has_audio);
  const bestVideo    = formats.find(f => f.has_video);
  const bestAudio    = formats.find(f => f.has_audio && !f.has_video);

  return {
    platform,
    type:             raw.is_live ? "live" : raw._type || "video",
    id:               raw.id,
    title:            raw.title            || "Untitled",
    description:      raw.description      ? raw.description.substring(0, 500) : null,
    uploader:         raw.uploader         || raw.creator || raw.channel || null,
    uploader_url:     raw.uploader_url     || raw.channel_url            || null,
    duration:         raw.duration         || null,
    duration_string:  raw.duration_string  || null,
    view_count:       raw.view_count       || null,
    like_count:       raw.like_count       || null,
    comment_count:    raw.comment_count    || null,
    upload_date:      raw.upload_date
      ? `${raw.upload_date.slice(0,4)}-${raw.upload_date.slice(4,6)}-${raw.upload_date.slice(6,8)}`
      : null,
    webpage_url:  raw.webpage_url  || raw.original_url || null,
    thumbnail:    raw.thumbnail    || raw.thumbnails?.[0]?.url || null,
    thumbnails:   (raw.thumbnails || []).slice(-3).map(t => ({
      url: t.url, width: t.width || null, height: t.height || null,
    })),
    download: {
      best:       bestCombined?.url || bestVideo?.url || null,
      best_audio: bestAudio?.url    || null,
      direct_url: raw.url           || null,
    },
    formats_count:        formats.length,
    formats,
    has_separate_streams: !bestCombined && !!(bestVideo && bestAudio),
  };
}

function formatPlaylist(raw) {
  return {
    platform:    "youtube_playlist",
    type:        "playlist",
    id:          raw.id,
    title:       raw.title       || "Untitled Playlist",
    description: raw.description || null,
    uploader:    raw.uploader    || raw.channel || null,
    url:         raw.webpage_url || raw.original_url,
    thumbnail:   raw.thumbnails?.[0]?.url || null,
    entry_count: raw.playlist_count || raw.entries?.length || 0,
    entries:     (raw.entries || []).map(e => ({
      id:        e.id,
      title:     e.title,
      url:       e.url || `https://www.youtube.com/watch?v=${e.id}`,
      duration:  e.duration  || null,
      thumbnail: e.thumbnails?.[0]?.url || null,
    })),
  };
}

// ─── Auto cleanup tmp files older than 2 hours ────────────────────────────────
setInterval(() => {
  try {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    fs.readdirSync(TMP_DIR).forEach(f => {
      try {
        const fp = path.join(TMP_DIR, f);
        if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
      } catch (_) {}
    });
  } catch (_) {}
}, 30 * 60 * 1000);

module.exports = {
  extract,
  downloadMerged,
  detectPlatform,
  validateUrl,
  getYtDlp,
  getFfmpeg,
  getCookiesFile,
};
