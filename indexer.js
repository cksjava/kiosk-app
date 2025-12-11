import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import mm from "music-metadata";

const MUSIC_DIR = "/mnt/musicdrive";
const db = new Database("music.db");

db.exec(`
CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  artist TEXT,
  album TEXT,
  path TEXT UNIQUE,
  duration REAL
);
`);

async function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await scanDir(fullPath);
    } else if (entry.name.toLowerCase().endsWith(".flac")) {
      try {
        const metadata = await mm.parseFile(fullPath);
        const { title, artist, album } = metadata.common;
        const duration = metadata.format.duration || 0;
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO tracks (title, artist, album, path, duration)
          VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(title || entry.name, artist || "Unknown", album || "Unknown", fullPath, duration);
        console.log("Indexed:", title || entry.name);
      } catch (err) {
        console.error("Error reading:", fullPath, err.message);
      }
    }
  }
}

await scanDir(MUSIC_DIR);
console.log("Indexing complete.");
