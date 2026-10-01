import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export interface UserRow {
  id: number;
  spotify_id: string;
  display_name: string | null;
  email: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: number | null;
  scopes: string | null;
  product: string | null;
  last_sync: string | null;
  created_at: string;
}

export type PreviewStatus = 'unknown' | 'spotify' | 'deezer' | 'none';

export interface SongRow {
  id: number;
  spotify_id: string;
  title: string;
  artist: string;
  album: string | null;
  image_url: string | null;
  isrc: string | null;
  preview_url: string | null;
  preview_status: PreviewStatus;
  deezer_id: number | null;
  deezer_rank: number | null;
  user_id: number;
  added_at: string | null;
  synced_at: string | null;
}

export interface SessionRow {
  id: number;
  user_id: number;
  current_song_id: number | null;
  round: number;
  attempts: number;
  max_snippet: number;
  skips_used: number;
  score: number;
  correct_count: number;
  status: 'active' | 'completed' | 'abandoned';
  spotify_playback: number;
  difficulty: number;
  created_at: string;
  finished_at: string | null;
}

const dbPath = path.resolve(process.env.DATABASE_URL ?? './db/game.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.resolve(__dirname, '../db/schema.sql'), 'utf8'));

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function run(sql: string, ...params: SQLInputValue[]) {
  const result = db.prepare(sql).run(...params);
  return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
}

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Fügt Spalten hinzu, die in älteren Datenbanken fehlen (CREATE TABLE IF NOT EXISTS ergänzt keine Spalten). */
function ensureColumn(table: string, column: string, definition: string) {
  const columns = all<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureColumn('users', 'scopes', 'TEXT');
ensureColumn('users', 'product', 'TEXT');
ensureColumn('game_sessions', 'spotify_playback', 'INTEGER NOT NULL DEFAULT 0');

ensureColumn('songs', 'deezer_rank', 'INTEGER');
ensureColumn('game_sessions', 'difficulty', 'INTEGER NOT NULL DEFAULT 0');

export interface SlotRow {
  session_id: number;
  difficulty: number;
  song_id: number;
  attempts: number;
  max_snippet: number;
  status: 'pending' | 'correct' | 'failed';
  points: number;
}

export const LIKED_SOURCE = 'liked';
export const LIKED_SOURCE_NAME = 'Lieblingssongs';

// Einmalige Migration (Schema-Version 1): Bisher gab es nur Liked Songs → alle vorhandenen Songs der
// Quelle 'liked' zuordnen, damit bestehende User ohne erneute Auswahl weiterspielen können.
// user_version stellt sicher, dass das nie wieder läuft (sonst würde eine leere Auswahl später überschrieben).
const schemaVersion = get<{ user_version: number }>('PRAGMA user_version')!.user_version;
if (schemaVersion < 1) {
  transaction(() => {
    db.exec(`INSERT OR IGNORE INTO song_sources (song_id, source_id) SELECT id, '${LIKED_SOURCE}' FROM songs`);
    run(
      `INSERT OR IGNORE INTO user_sources (user_id, source_id, name, track_count, synced_at)
       SELECT u.id, ?, ?, (SELECT COUNT(*) FROM songs s WHERE s.user_id = u.id), u.last_sync
       FROM users u WHERE EXISTS (SELECT 1 FROM songs s WHERE s.user_id = u.id)`,
      LIKED_SOURCE,
      LIKED_SOURCE_NAME,
    );
    db.exec('PRAGMA user_version = 1');
  });
}

/** SQL-Bedingung: Song gehört zu mindestens einer (ausgewählten) Quelle */
export const IN_SELECTED_SOURCES = 'id IN (SELECT song_id FROM song_sources)';

export function getUser(id: number): UserRow | undefined {
  return get<UserRow>('SELECT * FROM users WHERE id = ?', id);
}
