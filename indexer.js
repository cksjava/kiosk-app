import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { parseFile } from "music-metadata";

const MUSIC_DIR = "/mnt/musicdrive";
const COVERS_DIR = path.join(process.cwd(), "covers");
fs.mkdirSync(COVERS_DIR, { recursive: true });

const db = new Database("music.db");

db.exec(`
CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  artist TEXT,
  album TEXT,
  path TEXT UNIQUE,
  duration REAL,
  mtime INTEGER
);
`);

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO tracks (title, artist, album, path, duration, mtime)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const updateStmt = db.prepare(`
  UPDATE tracks
  SET title=?, artist=?, album=?, duration=?, mtime=?
  WHERE path=?
`);
const existingPaths = new Map(
  db.prepare("SELECT path, mtime FROM tracks").all().map(r => [r.path, r.mtime])
);

async function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await scanDir(fullPath);
      continue;
    }

    if (!entry.name.toLowerCase().endsWith(".flac")) continue;

    try {
      const stat = fs.statSync(fullPath);
      const lastMod = Math.floor(stat.mtimeMs);

      const existing = existingPaths.get(fullPath);
      if (existing && existing === lastMod) continue; // unchanged

      const metadata = await mm.parseFile(fullPath);
      const { title, artist, album, picture } = metadata.common;
      const duration = metadata.format.duration || 0;

      // Save album art if available
      if (picture && picture.length > 0) {
        const pic = picture[0];
        const coverFile = path.join(
          COVERS_DIR,
          `${path.basename(fullPath)}.jpg`
        );
        fs.writeFileSync(coverFile, pic.data);
      }

      if (existing) {
        updateStmt.run(
          title || entry.name,
          artist || "Unknown",
          album || "Unknown",
          duration,
          lastMod,
          fullPath
        );
        console.log("Updated:", fullPath);
      } else {
        insertStmt.run(
          title || entry.name,
          artist || "Unknown",
          album || "Unknown",
          fullPath,
          duration,
          lastMod
        );
        console.log("Indexed:", fullPath);
      }

      existingPaths.set(fullPath, lastMod);
    } catch (err) {
      console.error("Error reading:", fullPath, err.message);
    }
  }
}

export async function runScan() {
  console.log("Starting incremental scan...");
  await scanDir(MUSIC_DIR);
  console.log("Scan complete.");
}

// await scanDir(MUSIC_DIR);
// console.log("Indexing complete.");
