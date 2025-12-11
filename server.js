import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const db = new Database(path.join(__dirname, "music.db"));

// ----------------- MPV control via child_process -----------------

let mpvProcess = null;

function playWithMpv(filePath) {
  // Stop any existing playback
  if (mpvProcess) {
    try {
      mpvProcess.kill("SIGTERM");
    } catch (e) {
      console.error("Error killing existing mpv:", e);
    }
    mpvProcess = null;
  }

  console.log("Spawning mpv for:", filePath);

  // Adjust args if you need a specific device: e.g. --audio-device=alsa/plughw:0,0
  mpvProcess = spawn("mpv", ["--audio-device", "alsa/plugin:1,0", "--no-video", "--really-quiet", filePath], {
    stdio: "ignore", // no need to inherit terminal
  });

  mpvProcess.on("exit", (code, signal) => {
    console.log(`mpv exited (code=${code}, signal=${signal})`);
    mpvProcess = null;
  });
}

function stopMpv() {
  if (mpvProcess) {
    console.log("Stopping mpv");
    try {
      mpvProcess.kill("SIGTERM");
    } catch (e) {
      console.error("Error killing mpv:", e);
    }
    mpvProcess = null;
  }
}

// ----------------- Existing routes -----------------

app.get("/", (_req, res) => {
  res.send(`
    <html>
      <body style="font-family:sans-serif;text-align:center;padding-top:4rem;">
        <h1>🎵 Raspberry Pi Audio Kiosk</h1>
        <p>Try <a href="/tracks">/tracks</a> or <a href="/albums">/albums</a></p>
      </body>
    </html>
  `);
});

// All tracks
app.get("/tracks", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM tracks ORDER BY artist, album, id")
    .all();
  res.json(rows);
});

// Distinct albums
app.get("/albums", (_req, res) => {
  const rows = db
    .prepare(
      "SELECT album, artist, COUNT(*) as trackCount FROM tracks GROUP BY album, artist ORDER BY artist"
    )
    .all();
  res.json(rows);
});

// Tracks in a given album
app.get("/album/:album", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM tracks WHERE album = ? ORDER BY id")
    .all(req.params.album);
  res.json(rows);
});

// ----------------- Playback routes -----------------

// Play track by ID
app.get("/play/:id", (req, res) => {
  try {
    const track = db.prepare("SELECT path FROM tracks WHERE id = ?").get(req.params.id);
    if (!track) {
      console.error("Track not found for id:", req.params.id);
      return res.status(404).send("Track not found");
    }

    console.log("Request to play:", track.path);
    playWithMpv(track.path);
    res.send("Playing " + track.path);
  } catch (e) {
    console.error("Play error:", e);
    res.status(500).send(e.message || "Error starting playback");
  }
});

// Stop playback
app.get("/stop", (_req, res) => {
  try {
    stopMpv();
    res.send("Stopped");
  } catch (e) {
    console.error("Stop error:", e);
    res.status(500).send(e.message || "Error stopping playback");
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log("Server running at http://localhost:" + PORT));
