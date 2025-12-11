import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { spawn } from "child_process";
import net from "net";
import fs from "fs";
import { runScan } from "./indexer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const db = new Database(path.join(__dirname, "music.db"));

// ---- Persistent mpv instance with JSON IPC ----
const MPV_SOCKET = "/tmp/mpvsocket";
if (fs.existsSync(MPV_SOCKET)) fs.unlinkSync(MPV_SOCKET);

import { spawn } from "child_process";
const mpv = spawn("mpv", [
  "--idle=yes",
  "--no-terminal",
  "--input-ipc-server=" + MPV_SOCKET,
  "--audio-device=alsa/plughw:CARD=IQaudIODAC,DEV=0"
]);

mpv.on("exit", c => console.log("mpv exited with code", c));

// ----------------- MPV control via child_process -----------------

// let mpvProcess = null;

function mpvCommand(cmdArray) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(MPV_SOCKET);
    const msg = JSON.stringify({ command: cmdArray }) + "\n";
    client.write(msg);
    client.end();
    resolve();
  });
}

// function playWithMpv(filePath) {
//   // Stop any existing playback
//   if (mpvProcess) {
//     try {
//       mpvProcess.kill("SIGTERM");
//     } catch (e) {
//       console.error("Error killing existing mpv:", e);
//     }
//     mpvProcess = null;
//   }

//   console.log("Spawning mpv for:", filePath);

//   // Adjust args if you need a specific device: e.g. --audio-device=alsa/plughw:0,0
//   mpvProcess = spawn(
//     "mpv",
//     ["--audio-device=alsa/plughw:1,0", "--no-video", "--really-quiet", filePath],
//     { stdio: ["ignore", "pipe", "pipe"] }
//   );

//   mpvProcess.stdout.on("data", d => console.log("mpv:", d.toString()));
//   mpvProcess.stderr.on("data", d => console.error("mpv err:", d.toString()));

//   mpvProcess.on("exit", (code, signal) => {
//     console.log(`mpv exited (code=${code}, signal=${signal})`);
//     mpvProcess = null;
//   });
// }

// function stopMpv() {
//   if (mpvProcess) {
//     console.log("Stopping mpv");
//     try {
//       mpvProcess.kill("SIGTERM");
//     } catch (e) {
//       console.error("Error killing mpv:", e);
//     }
//     mpvProcess = null;
//   }
// }

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

app.get("/cover/:id", (req, res) => {
  const track = db.prepare("SELECT path FROM tracks WHERE id=?").get(req.params.id);
  const jpg = path.join(__dirname, "covers", path.basename(track.path) + ".jpg");
  if (fs.existsSync(jpg)) res.sendFile(jpg);
  else res.status(404).send("No cover");
});

app.post("/rescan", async (_req, res) => {
  try {
    await runScan();
    res.send("Rescan complete");
  } catch (e) {
    console.error("Rescan error:", e);
    res.status(500).send(e.message || "Rescan failed");
  }
});

// ----------------- Playback routes -----------------

app.get("/play/:id", async (req, res) => {
  const track = db.prepare("SELECT path FROM tracks WHERE id=?").get(req.params.id);
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
  const v = parseInt(req.params.value);
  await mpvCommand(["set_property", "volume", v]);
  res.send("Volume set to " + v);
});

const PORT = 3000;
app.listen(PORT, () => console.log("Server running at http://localhost:" + PORT));
