import { Router } from 'express';
import { all, IN_SELECTED_SOURCES } from '../database';
import { isSyncing, syncUser } from '../sync';

const router = Router();

// GET /api/songs/search?q=... → Autocomplete über Titel und Artist der Songs aus den ausgewählten Quellen
router.get('/search', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) return res.json({ songs: [] });

  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const contains = `%${escaped}%`;
  const prefix = `${escaped}%`;
  const rows = all<{ id: number; title: string; artist: string; album: string | null; image_url: string | null }>(
    `SELECT id, title, artist, album, image_url FROM songs
     WHERE user_id = ? AND ${IN_SELECTED_SOURCES} AND (title LIKE ? ESCAPE '\\' OR artist LIKE ? ESCAPE '\\')
     ORDER BY (title LIKE ? ESCAPE '\\') DESC, title COLLATE NOCASE
     LIMIT 20`,
    req.userId, contains, contains, prefix,
  );
  res.json({
    songs: rows.map((r) => ({ id: r.id, title: r.title, artist: r.artist, album: r.album, imageUrl: r.image_url })),
  });
});

// POST /api/songs/sync → manueller Sync aller ausgewählten Quellen (läuft im Hintergrund)
router.post('/sync', (req, res) => {
  if (!isSyncing(req.userId)) {
    syncUser(req.userId).catch((err) => console.error(`[sync] User ${req.userId}:`, (err as Error).message));
  }
  res.status(202).json({ syncing: true });
});

export default router;
