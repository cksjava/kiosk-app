import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { parseFile } from "music-metadata";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- Paths ----
const MUSIC_DIR = "/media/chandrakant/Crucial X9/";
export const COVERS_DIR = path.join(__dirname, "covers");
fs.mkdirSync(COVERS_DIR, { recursive: true });

const db = new Database("music.db");

// ---- DB Schema ----
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

// ---- Prepared statements ----
const selectAlbumByTitleStmt = db.prepare(
  "SELECT id, artist FROM albums WHERE title = ? LIMIT 1"
);
const insertAlbumStmt = db.prepare(
  "INSERT OR IGNORE INTO albums (title, artist) VALUES (?, ?)"
);
const updateAlbumArtistStmt = db.prepare(
  "UPDATE albums SET artist = ? WHERE id = ?"
);

const selectTrackByTitleArtistAlbumStmt = db.prepare(`
  SELECT id FROM tracks
  WHERE title = ? AND artist = ? AND album_id IS ?
  LIMIT 1
`);
const insertTrackStmt = db.prepare(`
  INSERT OR IGNORE INTO tracks (title, artist, album_id, path, duration, mtime)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const updateTrackByPathStmt = db.prepare(`
  UPDATE tracks
  SET title = ?, artist = ?, album_id = ?, duration = ?, mtime = ?
  WHERE path = ?
`);
const selectTrackByPathStmt = db.prepare(`
  SELECT id FROM tracks WHERE path = ? LIMIT 1
`);

const selectArtistByCanonicalStmt = db.prepare(`
  SELECT id, name FROM artists WHERE canonical_name = ? LIMIT 1
`);
const insertArtistStmt = db.prepare(`
  INSERT INTO artists (name, canonical_name) VALUES (?, ?)
`);

const insertAlbumArtistLinkStmt = db.prepare(`
  INSERT OR IGNORE INTO album_artists (album_id, artist_id)
  VALUES (?, ?)
`);
const insertTrackArtistLinkStmt = db.prepare(`
  INSERT OR IGNORE INTO track_artists (track_id, artist_id)
  VALUES (?, ?)
`);

const selectAlbumArtistsNamesStmt = db.prepare(`
  SELECT ar.name
  FROM artists ar
  JOIN album_artists aa ON aa.artist_id = ar.id
  WHERE aa.album_id = ?
  ORDER BY LOWER(ar.name)
`);

// ---- Helpers ----
function normOr(val, fallback) {
  if (!val || typeof val !== "string") return fallback;
  const trimmed = val.trim();
  return trimmed.length ? trimmed : fallback;
}

/**
 * Normalize a name for deduplication:
 *  - trim
 *  - collapse multiple spaces
 *  - drop trailing punctuation like commas/periods
 *  - lowercase
 */
function canonicalArtistKey(name) {
  if (!name) return "";
  let s = String(name).trim();

  // Collapse multiple spaces to a single space
  s = s.replace(/\s+/g, " ");

  // Remove trailing punctuation like , . ; :
  s = s.replace(/[.,;:]+$/g, "").trim();

  return s.toLowerCase();
}

/**
 * Split an artist string into individual names.
 * Handles comma, ampersand and the word "and" as separators.
 */
function parseArtistNames(raw) {
  if (!raw) return [];

  let s = String(raw);

  // Normalize separators: "&" and "and" → ","
  s = s.replace(/&/g, ",");
  s = s.replace(/\band\b/gi, ",");

  const parts = s
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const seen = new Map();
  for (const name of parts) {
    const key = canonicalArtistKey(name);
    if (!key) continue;
    if (!seen.has(key)) {
      // store the first spelling we see
      seen.set(key, name.trim());
    }
  }
  return Array.from(seen.values());
}

/**
 * Format a list of artist names:
 *  - "A"
 *  - "A and B"
 *  - "A, B and C"
 * Names sorted alphabetically (case-insensitive).
 */
function buildArtistListString(names) {
  if (!names || names.length === 0) return "";

  const sorted = [...names].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );

  if (sorted.length === 1) return sorted[0];
  if (sorted.length === 2) return `${sorted[0]} and ${sorted[1]}`;

  const head = sorted.slice(0, -1).join(", ");
  const last = sorted[sorted.length - 1];
  return `${head} and ${last}`;
}

/**
 * Get or create artist rows for a set of names.
 * Returns array of { id, name }.
 */
function getOrCreateArtistsForNames(names) {
  const result = [];

  for (const name of names) {
    const canonical = canonicalArtistKey(name);
    if (!canonical) continue;

    let row = selectArtistByCanonicalStmt.get(canonical);
    if (!row) {
      const info = insertArtistStmt.run(name, canonical);
      const newId =
        typeof info.lastInsertRowid === "number"
          ? info.lastInsertRowid
          : selectArtistByCanonicalStmt.get(canonical)?.id;
      row = { id: newId, name };
    }
    result.push(row);
  }

  return result;
}

/**
 * Get or create an album by title.
 * For new albums, artist string is initially empty; it will be filled
 * based on the album_artists links.
 */
function getOrCreateAlbumId(titleRaw) {
  const title = normOr(titleRaw, "Unknown Album");
  const existing = selectAlbumByTitleStmt.get(title);
  if (existing) return existing.id;

  const info = insertAlbumStmt.run(title, "");
  const albumId =
    typeof info.lastInsertRowid === "number"
      ? info.lastInsertRowid
      : selectAlbumByTitleStmt.get(title).id;
  return albumId;
}

/**
 * Ensure album_artists links exist for given (albumId, artistIds),
 * then recompute the album.artist display string from linked artists.
 */
function updateAlbumArtistsAndName(albumId, artistIds) {
  if (!albumId || !artistIds || artistIds.length === 0) return;

  for (const artistId of artistIds) {
    insertAlbumArtistLinkStmt.run(albumId, artistId);
  }

  const rows = selectAlbumArtistsNamesStmt.all(albumId);
  const names = rows.map((r) => r.name).filter(Boolean);
  const artistStr = buildArtistListString(names);

  updateAlbumArtistStmt.run(artistStr, albumId);
}

/**
 * Ensure track_artists links exist for given (trackId, artistIds).
 */
function updateTrackArtists(trackId, artistIds) {
  if (!trackId || !artistIds || artistIds.length === 0) return;
  for (const artistId of artistIds) {
    insertTrackArtistLinkStmt.run(trackId, artistId);
  }
}

function writeCoverFile(baseName, ext, data) {
  const filePath = path.join(COVERS_DIR, `${baseName}${ext}`);
  fs.writeFileSync(filePath, data);
  console.log("Saved cover:", filePath);
}

// ---- Scanner ----
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
      const mtime = Math.floor(stat.mtimeMs);
      const metadata = await parseFile(fullPath);

      const title = normOr(metadata.common.title, path.parse(fullPath).name);
      const rawArtist = normOr(metadata.common.artist, "Unknown Artist");
      const albumTitle = normOr(metadata.common.album, "Unknown Album");
      const duration = metadata.format.duration || 0;

      // Parse and normalize artist names
      let artistNames = parseArtistNames(rawArtist);
      if (artistNames.length === 0) {
        artistNames = ["Unknown Artist"];
      }

      // Cleaned display string for track.artist
      const trackArtistDisplay = buildArtistListString(artistNames);

      // Ensure artist rows exist
      const artistRows = getOrCreateArtistsForNames(artistNames);
      const artistIds = artistRows.map((r) => r.id);

      // Ensure album exists and update album_artists + album.artist
      const albumId = getOrCreateAlbumId(albumTitle);
      updateAlbumArtistsAndName(albumId, artistIds);

      // Track: upsert
      const existingTrack = selectTrackByTitleArtistAlbumStmt.get(
        title,
        trackArtistDisplay,
        albumId
      );

      let trackId;
      if (existingTrack) {
        trackId = existingTrack.id;
        updateTrackByPathStmt.run(
          title,
          trackArtistDisplay,
          albumId,
          duration,
          mtime,
          fullPath
        );
      } else {
        insertTrackStmt.run(
          title,
          trackArtistDisplay,
          albumId,
          fullPath,
          duration,
          mtime
        );
        const row = selectTrackByPathStmt.get(fullPath);
        trackId = row?.id;
      }

      // Link track to artists
      if (trackId) {
        updateTrackArtists(trackId, artistIds);
      }

      // ---- Save covers for album and track ----
      const picture = metadata.common.picture;
      if (picture && picture.length > 0 && trackId && albumId) {
        const pic = picture[0];
        const ext =
          pic.format && pic.format.includes("png") ? ".png" : ".jpg";
        // track-level cover
        writeCoverFile(`track-${trackId}`, ext, pic.data);
        // album-level cover (only if missing)
        const albumFile = path.join(COVERS_DIR, `album-${albumId}${ext}`);
        if (!fs.existsSync(albumFile)) {
          writeCoverFile(`album-${albumId}`, ext, pic.data);
        }
      }
    } catch (err) {
      console.error("Error reading:", fullPath, err.message);
    }
  }
}

// ---- Entry ----
export async function runScan() {
  console.log("Starting scan...");
  await scanDir(MUSIC_DIR);
  console.log("Scan complete.");
}
