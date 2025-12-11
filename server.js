import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

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

const PORT = 3000;
app.listen(PORT, () => console.log("Server running at http://localhost:" + PORT));
