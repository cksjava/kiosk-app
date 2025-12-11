import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import MPV from "node-mpv";

// --------------------- MPV player setup ---------------------
const mpv = new MPV({
  audio_only: true,
  ipcCommand: true,
  auto_restart: true,
  debug: false
});

// Start MPV once on server startup
(async () => {
  try {
    await mpv.start();
    console.log("MPV started");
  } catch (err) {
    console.error("Failed to start MPV:", err);
  }
})();

// Handle errors silently so server keeps running
mpv.on("error", err => console.error("MPV error:", err.message));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const db = new Database(path.join(__dirname, "music.db"));

// Home page
app.get("/", (_req, res) => {
  res.send(`<html><body><h1>🎵 Raspberry Pi Audio Kiosk</h1>
  <p>Try <a href="/tracks">/tracks</a> or <a href="/albums">/albums</a></p>
  </body></html>`);
});

// All tracks
app.get("/tracks", (_req, res) => {
  const rows = db.prepare("SELECT * FROM tracks ORDER BY artist, album, id").all();
  res.json(rows);
});

// Distinct albums with artist
app.get("/albums", (_req, res) => {
  const rows = db.prepare(
    "SELECT album, artist, COUNT(*) as trackCount FROM tracks GROUP BY album, artist ORDER BY artist"
  ).all();
  res.json(rows);
});

// Tracks in a given album
app.get("/album/:album", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM tracks WHERE album = ? ORDER BY id")
    .all(req.params.album);
  res.json(rows);
});

// Play a track by ID
app.get("/play/:id", async (req, res) => {
  try {
    const track = db.prepare("SELECT path FROM tracks WHERE id = ?").get(req.params.id);
    if (!track) {
      console.error("Track not found for id:", req.params.id);
      return res.status(404).send("Track not found");
    }

    console.log("Request to play:", track.path);
    await mpv.load(track.path); // no `.then`, just await

    res.send("Playing " + track.path);
  } catch (e) {
    console.error("Play error:", e);
    res.status(500).send(e.message || "Error starting playback");
  }
});

// Pause / resume
app.get("/pause", async (_req, res) => {
  try {
    await mpv.togglePause();
    res.send("Toggled pause");
  } catch (e) {
    console.error("Pause error:", e);
    res.status(500).send(e.message || "Error toggling pause");
  }
});

app.get("/stop", async (_req, res) => {
  try {
    await mpv.stop();
    res.send("Stopped");
  } catch (e) {
    console.error("Stop error:", e);
    res.status(500).send(e.message || "Error stopping playback");
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log("Server running at http://localhost:" + PORT));
