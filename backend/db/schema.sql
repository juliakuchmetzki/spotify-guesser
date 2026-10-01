CREATE TABLE IF NOT EXISTS users (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  spotify_id       TEXT NOT NULL UNIQUE,
  display_name     TEXT,
  email            TEXT,
  access_token     TEXT,
  refresh_token    TEXT,
  token_expires_at INTEGER,               -- Unix-Zeit in ms
  scopes           TEXT,                  -- gewährte OAuth-Scopes (leerzeichengetrennt)
  product          TEXT,                  -- Spotify-Abo: premium | free | …
  last_sync        TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS songs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  spotify_id     TEXT NOT NULL,
  title          TEXT NOT NULL,
  artist         TEXT NOT NULL,
  album          TEXT,
  image_url      TEXT,
  isrc           TEXT,
  preview_url    TEXT,                    -- nur gesetzt, wenn Spotify selbst eine Preview liefert
  preview_status TEXT NOT NULL DEFAULT 'unknown', -- unknown | spotify | deezer | none
  deezer_id      INTEGER,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at       TEXT,
  synced_at      TEXT,
  UNIQUE (spotify_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_songs_user ON songs(user_id);

CREATE TABLE IF NOT EXISTS game_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_song_id INTEGER REFERENCES songs(id) ON DELETE SET NULL,
  round           INTEGER NOT NULL DEFAULT 1,
  attempts        INTEGER NOT NULL DEFAULT 0, -- falsche Versuche in der aktuellen Runde
  max_snippet     REAL NOT NULL DEFAULT 0,    -- längstes gehörtes Snippet in der aktuellen Runde (s)
  skips_used      INTEGER NOT NULL DEFAULT 0,
  score           INTEGER NOT NULL DEFAULT 0,
  correct_count   INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active', -- active | completed | abandoned
  spotify_playback INTEGER NOT NULL DEFAULT 0, -- 1 = Audio über Spotify SDK → Songs ohne Deezer-Preview erlaubt
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON game_sessions(user_id);

CREATE TABLE IF NOT EXISTS game_rounds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  song_id     INTEGER REFERENCES songs(id) ON DELETE SET NULL,
  round       INTEGER NOT NULL,
  attempts    INTEGER NOT NULL,
  max_snippet REAL NOT NULL,
  points      INTEGER NOT NULL,
  result      TEXT NOT NULL,              -- correct | failed | skipped
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rounds_session ON game_rounds(session_id);

-- Welche Quellen (Lieblingssongs oder Playlists) der User fürs Spiel ausgewählt hat
CREATE TABLE IF NOT EXISTS user_sources (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id   TEXT NOT NULL,              -- 'liked' oder Spotify-Playlist-ID
  name        TEXT NOT NULL,
  image_url   TEXT,
  track_count INTEGER,                    -- Songs nach dem letzten Sync
  synced_at   TEXT,
  error       TEXT,                       -- Fehler beim letzten Sync (z. B. kein Zugriff)
  PRIMARY KEY (user_id, source_id)
);

-- Aus welchen Quellen ein Song stammt (ein Song kann in mehreren Playlists stehen)
CREATE TABLE IF NOT EXISTS song_sources (
  song_id   INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  PRIMARY KEY (song_id, source_id)
);
CREATE INDEX IF NOT EXISTS idx_song_sources_source ON song_sources(source_id);
