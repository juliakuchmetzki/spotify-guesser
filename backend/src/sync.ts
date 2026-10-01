import cron from 'node-cron';
import { all, db, getUser, LIKED_SOURCE, run, transaction } from './database';
import { getPlaylistTracks, getUserLikedTracks, getValidAccessToken, SpotifyError, type LikedTrack } from './spotify';

const runningSyncs = new Set<number>();

export function isSyncing(userId: number): boolean {
  return runningSyncs.has(userId);
}

function fetchSourceTracks(accessToken: string, sourceId: string): Promise<LikedTrack[]> {
  return sourceId === LIKED_SOURCE ? getUserLikedTracks(accessToken) : getPlaylistTracks(accessToken, sourceId);
}

function syncErrorMessage(err: unknown): string {
  if (err instanceof SpotifyError) {
    if (err.status === 403) return 'Kein Zugriff – Spotify gibt nur eigene oder gemeinsame Playlists frei';
    if (err.status === 404) return 'Playlist nicht gefunden (gelöscht?)';
  }
  return 'Konnte nicht geladen werden';
}

/** Lädt eine Quelle (Lieblingssongs oder Playlist) und ersetzt deren Song-Zuordnungen. */
export async function syncSource(userId: number, accessToken: string, sourceId: string): Promise<number> {
  const tracks = await fetchSourceTracks(accessToken, sourceId);
  const syncedAt = new Date().toISOString();

  const upsert = db.prepare(`
    INSERT INTO songs (spotify_id, title, artist, album, image_url, isrc, preview_url, preview_status, user_id, added_at, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (spotify_id, user_id) DO UPDATE SET
      title = excluded.title,
      artist = excluded.artist,
      album = excluded.album,
      image_url = excluded.image_url,
      isrc = excluded.isrc,
      synced_at = excluded.synced_at,
      preview_url = COALESCE(excluded.preview_url, songs.preview_url),
      preview_status = CASE WHEN excluded.preview_url IS NOT NULL THEN 'spotify' ELSE songs.preview_status END
    RETURNING id
  `);
  const link = db.prepare('INSERT OR IGNORE INTO song_sources (song_id, source_id) VALUES (?, ?)');

  transaction(() => {
    run(
      'DELETE FROM song_sources WHERE source_id = ? AND song_id IN (SELECT id FROM songs WHERE user_id = ?)',
      sourceId,
      userId,
    );
    for (const t of tracks) {
      // ?? null: node:sqlite wirft bei undefined "Provided value cannot be bound to SQLite parameter N"
      const params = [
        t.spotifyId, t.title, t.artist, t.album ?? null, t.imageUrl ?? null, t.isrc ?? null, t.previewUrl ?? null,
        t.previewUrl ? 'spotify' : 'unknown', userId, t.addedAt ?? null, syncedAt,
      ] as const;
      try {
        const row = upsert.get(...params) as { id: number };
        link.run(row.id, sourceId);
      } catch (err) {
        console.error('[sync] Insert fehlgeschlagen für', { title: t.title, artist: t.artist, previewUrl: t.previewUrl }, params);
        throw err;
      }
    }
    run(
      'UPDATE user_sources SET track_count = ?, synced_at = ?, error = NULL WHERE user_id = ? AND source_id = ?',
      tracks.length,
      syncedAt,
      userId,
      sourceId,
    );
  });
  return tracks.length;
}

/** Entfernt Songs, die zu keiner ausgewählten Quelle mehr gehören (außer dem Song eines laufenden Spiels). */
export function removeOrphanSongs(userId: number): void {
  run(
    `DELETE FROM songs WHERE user_id = ?
       AND id NOT IN (SELECT song_id FROM song_sources)
       AND id NOT IN (SELECT current_song_id FROM game_sessions WHERE status = 'active' AND current_song_id IS NOT NULL)`,
    userId,
  );
}

/** Synchronisiert alle ausgewählten Quellen des Users (oder nur die angegebenen). */
export async function syncUser(userId: number, onlySources?: string[]): Promise<void> {
  if (runningSyncs.has(userId)) return;
  runningSyncs.add(userId);
  try {
    const user = getUser(userId);
    if (!user?.refresh_token) return;
    const sources = all<{ source_id: string }>('SELECT source_id FROM user_sources WHERE user_id = ?', userId)
      .map((s) => s.source_id)
      .filter((id) => !onlySources || onlySources.includes(id));
    if (sources.length === 0) return;

    const accessToken = await getValidAccessToken(user);
    let total = 0;
    for (const sourceId of sources) {
      try {
        total += await syncSource(userId, accessToken, sourceId);
      } catch (err) {
        console.error(`[sync] User ${userId}, Quelle ${sourceId}:`, (err as Error).message);
        run('UPDATE user_sources SET error = ? WHERE user_id = ? AND source_id = ?', syncErrorMessage(err), userId, sourceId);
      }
    }
    removeOrphanSongs(userId);
    run("UPDATE users SET last_sync = datetime('now') WHERE id = ?", userId);
    console.log(`[sync] User ${userId}: ${total} Songs aus ${sources.length} Quelle(n) synchronisiert`);
  } finally {
    runningSyncs.delete(userId);
  }
}

export async function syncAllUsers(): Promise<void> {
  const users = all<{ id: number }>('SELECT id FROM users WHERE refresh_token IS NOT NULL');
  for (const { id } of users) {
    try {
      await syncUser(id);
    } catch (err) {
      console.error(`[sync] User ${id} fehlgeschlagen:`, (err as Error).message);
    }
  }
}

/** Täglicher Sync der ausgewählten Quellen um 00:00 UTC. */
export function startSyncScheduler(): void {
  cron.schedule('0 0 * * *', () => void syncAllUsers(), { timezone: 'UTC' });
  console.log('[sync] Täglicher Sync geplant (00:00 UTC)');
}
