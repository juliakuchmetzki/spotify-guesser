import { Router } from 'express';
import { all, getUser, LIKED_SOURCE, LIKED_SOURCE_NAME, run, transaction } from '../database';
import { getUserPlaylists, getValidAccessToken, hasScopes, PLAYLIST_SCOPES, SpotifyError } from '../spotify';
import { isSyncing, removeOrphanSongs, syncUser } from '../sync';

const router = Router();

interface SourceRow {
  source_id: string;
  name: string;
  image_url: string | null;
  track_count: number | null;
  synced_at: string | null;
  error: string | null;
}

const MAX_SOURCES = 20;

// GET /api/playlists → Playlists aus Spotify + aktuelle Auswahl
router.get('/', async (req, res) => {
  const user = getUser(req.userId)!;
  const selected = all<SourceRow>('SELECT * FROM user_sources WHERE user_id = ?', user.id);
  const selectedIds = new Set(selected.map((s) => s.source_id));
  const missingScope = !hasScopes(user, PLAYLIST_SCOPES);

  let playlists: Awaited<ReturnType<typeof getUserPlaylists>> = [];
  if (!missingScope) {
    try {
      playlists = await getUserPlaylists(await getValidAccessToken(user));
    } catch (err) {
      console.error('[playlists]', (err as Error).message);
      const status = err instanceof SpotifyError && err.status === 401 ? 401 : 502;
      return res.status(502).json({
        error: status === 401 ? 'Spotify-Anmeldung abgelaufen – bitte neu anmelden' : 'Playlists konnten nicht von Spotify geladen werden',
      });
    }
  }

  res.json({
    missingScope,
    syncing: isSyncing(user.id),
    sources: selected.map((s) => ({
      id: s.source_id,
      name: s.name,
      trackCount: s.track_count,
      syncedAt: s.synced_at,
      error: s.error,
    })),
    playlists: playlists.map((p) => ({
      id: p.id,
      name: p.name,
      imageUrl: p.imageUrl,
      trackCount: p.trackCount,
      ownerName: p.ownerName,
      // Seit Februar 2026 liefert Spotify Inhalte nur für eigene oder gemeinsame Playlists
      selectable: p.ownerId === user.spotify_id || p.collaborative,
      selected: selectedIds.has(p.id),
    })),
    liked: { selected: selectedIds.has(LIKED_SOURCE) },
  });
});

// PUT /api/playlists/selection { sourceIds: string[] } → Auswahl speichern und Songs im Hintergrund laden
router.put('/selection', async (req, res) => {
  const user = getUser(req.userId)!;
  const raw: unknown = req.body?.sourceIds;
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every((id) => typeof id === 'string')) {
    return res.status(400).json({ error: 'Bitte mindestens eine Quelle auswählen' });
  }
  const ids = [...new Set(raw as string[])];
  if (ids.length > MAX_SOURCES) return res.status(400).json({ error: `Maximal ${MAX_SOURCES} Quellen` });
  if (isSyncing(user.id)) return res.status(409).json({ error: 'Es wird gerade synchronisiert – bitte kurz warten' });

  // Namen und Zugriff serverseitig bei Spotify prüfen, nicht dem Client glauben
  const playlistIds = ids.filter((id) => id !== LIKED_SOURCE);
  const sources: { id: string; name: string; imageUrl: string | null }[] = [];
  if (ids.includes(LIKED_SOURCE)) sources.push({ id: LIKED_SOURCE, name: LIKED_SOURCE_NAME, imageUrl: null });
  if (playlistIds.length > 0) {
    if (!hasScopes(user, PLAYLIST_SCOPES)) return res.status(403).json({ error: 'Für Playlists bitte neu anmelden' });
    let playlists;
    try {
      playlists = await getUserPlaylists(await getValidAccessToken(user));
    } catch (err) {
      console.error('[playlists]', (err as Error).message);
      return res.status(502).json({ error: 'Playlists konnten nicht von Spotify geladen werden' });
    }
    for (const id of playlistIds) {
      const p = playlists.find((x) => x.id === id);
      if (!p) return res.status(400).json({ error: 'Unbekannte Playlist' });
      if (p.ownerId !== user.spotify_id && !p.collaborative) {
        return res.status(400).json({ error: `„${p.name}“ gehört dir nicht – Spotify gibt die Songs nicht frei` });
      }
      sources.push({ id: p.id, name: p.name, imageUrl: p.imageUrl });
    }
  }

  transaction(() => {
    const keep = sources.map((s) => s.id);
    const placeholders = keep.map(() => '?').join(', ');
    // Abgewählte Quellen: Zuordnungen lösen (Songs ohne Quelle werden danach entfernt)
    run(
      `DELETE FROM song_sources WHERE source_id NOT IN (${placeholders})
         AND song_id IN (SELECT id FROM songs WHERE user_id = ?)`,
      ...keep,
      user.id,
    );
    run(`DELETE FROM user_sources WHERE user_id = ? AND source_id NOT IN (${placeholders})`, user.id, ...keep);
    for (const s of sources) {
      run(
        `INSERT INTO user_sources (user_id, source_id, name, image_url) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, source_id) DO UPDATE SET name = excluded.name, image_url = excluded.image_url`,
        user.id,
        s.id,
        s.name,
        s.imageUrl,
      );
    }
    // Andere Songs → laufendes Spiel passt nicht mehr
    run("UPDATE game_sessions SET status = 'abandoned' WHERE user_id = ? AND status = 'active'", user.id);
  });
  removeOrphanSongs(user.id);

  syncUser(user.id).catch((err) => console.error(`[sync] User ${user.id}:`, (err as Error).message));
  res.status(202).json({ syncing: true });
});

export default router;
