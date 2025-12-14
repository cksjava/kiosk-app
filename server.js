import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { spawn } from "child_process";
import net from "net";
import fs from "fs";
import { runScan } from "./indexer.js";
import { configDotenv } from "dotenv";

configDotenv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const db = new Database(path.join(__dirname, "music.db"));

// ─────────────────────────────────────────────
// Ensure DB schema exists (safe even if indexer
// already created the tables).
// ─────────────────────────────────────────────
db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS albums (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  title  TEXT NOT NULL,
  artist TEXT,
  UNIQUE(title)
);

CREATE TABLE IF NOT EXISTS tracks (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  title    TEXT NOT NULL,
  artist   TEXT NOT NULL,
  album_id INTEGER,
  path     TEXT UNIQUE,
  duration REAL,
  mtime    INTEGER,
  FOREIGN KEY (album_id) REFERENCES albums(id),
  UNIQUE(title, artist, album_id)
);

CREATE TABLE IF NOT EXISTS playlists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id INTEGER NOT NULL,
  track_id    INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, track_id),
  FOREIGN KEY (playlist_id) REFERENCES playlists(id),
  FOREIGN KEY (track_id)    REFERENCES tracks(id)
);

CREATE TABLE IF NOT EXISTS artists (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  canonical_name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS album_artists (
  album_id  INTEGER NOT NULL,
  artist_id INTEGER NOT NULL,
  PRIMARY KEY (album_id, artist_id),
  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS track_artists (
  track_id  INTEGER NOT NULL,
  artist_id INTEGER NOT NULL,
  PRIMARY KEY (track_id, artist_id),
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
  FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
);
`);

const COVERS_DIR = path.join(__dirname, "covers");

// ─────────────────────────────────────────────
// Persistent mpv instance with JSON IPC
// ─────────────────────────────────────────────

const MPV_SOCKET = "/tmp/mpvsocket";
if (fs.existsSync(MPV_SOCKET)) fs.unlinkSync(MPV_SOCKET);

const mpvArgs = [
  "--idle=yes",
  "--no-terminal",
  "--no-video",          // prevent album-art display
  "--vo=null",           // disable any video output backend
  `--input-ipc-server=${MPV_SOCKET}`,
];

if (process.env.AUDIO_DEVICE) {
  mpvArgs.push(`--audio-device=${process.env.AUDIO_DEVICE}`);
}

const mpv = spawn("mpv", mpvArgs);

mpv.on("exit", (c) => console.log("mpv exited with code", c));

// MPV control via IPC
function mpvCommand(cmdArray) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(MPV_SOCKET);
    client.on("error", (err) => {
      console.error("MPV IPC error:", err.message || err);
      reject(err);
    });
    const msg = JSON.stringify({ command: cmdArray }) + "\n";
    client.write(msg);
    client.end();
    resolve();
  });
}

// ─────────────────────────────────────────────
// Caching / static
// ─────────────────────────────────────────────
app.set("etag", false);

app.use((_req, res, next) => {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
});

app.use(
  express.static(path.join(__dirname, "../kiosk-ui/dist"), {
    etag: false,
    lastModified: false,
    cacheControl: false,
    maxAge: 0,
  })
);

// ─────────────────────────────────────────────
// API routes (albums / tracks)
// ─────────────────────────────────────────────

// All tracks (joined with albums)
// Keeps `album` field for compatibility, also exposes `albumId`.
app.get("/tracks", (_req, res) => {
  const rows = db
    .prepare(
      `
      SELECT
        t.id,
        t.title,
        t.artist,
        a.title AS album,
        a.id    AS albumId,
        t.path,
        t.duration,
        t.mtime
      FROM tracks t
      LEFT JOIN albums a ON t.album_id = a.id
      ORDER BY t.artist, a.title, t.id
      `
    )
    .all();

  res.json(rows);
});

// Distinct albums with track counts
// Keeps `album` + `artist` from old API, adds `id`.
app.get("/albums", (_req, res) => {
  const rows = db
    .prepare(
      `
      SELECT
        a.id,
        a.title  AS album,
        a.artist AS artist,
        COUNT(t.id) AS trackCount
      FROM albums a
      LEFT JOIN tracks t ON t.album_id = a.id
      GROUP BY a.id
      ORDER BY a.artist, a.title
      `
    )
    .all();

  res.json(rows);
});

// Tracks in a given album (by album title, for compatibility)
app.get("/album/:album", (req, res) => {
  const albumTitle = req.params.album;

  const rows = db
    .prepare(
      `
      SELECT
        t.id,
        t.title,
        t.artist,
        a.title AS album,
        a.id    AS albumId,
        t.path,
        t.duration,
        t.mtime
      FROM tracks t
      JOIN albums a ON t.album_id = a.id
      WHERE a.title = ?
      ORDER BY t.title ASC
      `
    )
    .all(albumTitle);

  res.json(rows);
});

// Cover by track id (legacy endpoint)
app.get("/cover/:id", (req, res) => {
  const track = db
    .prepare("SELECT path FROM tracks WHERE id = ?")
    .get(req.params.id);

  if (!track) {
    return res.status(404).send("Track not found");
  }

  const jpg = path.join(
    __dirname,
    "covers",
    path.basename(track.path) + ".jpg"
  );

  if (fs.existsSync(jpg)) {
    res.sendFile(jpg);
  } else {
    res.status(404).send("No cover");
  }
});

app.get("/album-cover/:albumId", (req, res) => {
  const albumFile = path.join(COVERS_DIR, `album-${req.params.albumId}.jpg`);
  if (fs.existsSync(albumFile)) return res.sendFile(albumFile);
  res.status(404).send("No album cover");
});

app.get("/track-cover/:trackId", (req, res) => {
  const trackFile = path.join(COVERS_DIR, `track-${req.params.trackId}.jpg`);
  if (fs.existsSync(trackFile)) return res.sendFile(trackFile);
  res.status(404).send("No track cover");
});

// ─────────────────────────────────────────────
// Library maintenance
// ─────────────────────────────────────────────
app.post("/rescan", async (_req, res) => {
  try {
    await runScan();
    res.send("Rescan complete");
  } catch (e) {
    console.error("Rescan error:", e);
    res.status(500).send(e.message || "Rescan failed");
  }
});

// ─────────────────────────────────────────────
// Playback routes
// ─────────────────────────────────────────────
app.get("/play/:id", async (req, res) => {
  const track = db
    .prepare("SELECT path FROM tracks WHERE id = ?")
    .get(req.params.id);

  if (!track) return res.status(404).send("Track not found");

  await mpvCommand(["loadfile", track.path]);
  res.send("Playing " + track.path);
});

app.get("/pause", async (_req, res) => {
  await mpvCommand(["cycle", "pause"]);
  res.send("Toggled pause");
});

app.get("/stop", async (_req, res) => {
  await mpvCommand(["stop"]);
  res.send("Stopped");
});

app.get("/volume/:value", async (req, res) => {
  const v = parseInt(req.params.value, 10);
  if (Number.isNaN(v)) {
    return res.status(400).send("Invalid volume value");
  }
  await mpvCommand(["set_property", "volume", v]);
  res.send("Volume set to " + v);
});

app.get("/seek/:seconds", async (req, res) => {
  const seconds = parseFloat(req.params.seconds);

  if (Number.isNaN(seconds) || seconds < 0) {
    return res.status(400).send("Invalid seek position");
  }

  try {
    await mpvCommand(["set_property", "time-pos", seconds]);
    res.send(`Seeked to ${seconds} seconds`);
  } catch (err) {
    console.error("Seek error:", err);
    res.status(500).send("Failed to seek");
  }
});

// ─────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────
const PORT = 3000;
app.listen(PORT, () =>
  console.log("Server running at http://localhost:" + PORT)
);
