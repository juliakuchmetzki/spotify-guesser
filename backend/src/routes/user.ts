import { Router } from 'express';
import { get, getUser, IN_SELECTED_SOURCES } from '../database';
import { getValidAccessToken, streamingStatus } from '../spotify';
import { isSyncing } from '../sync';

const router = Router();

// GET /api/user/me → aktueller User + Statistiken
router.get('/me', (req, res) => {
  const user = getUser(req.userId)!;
  const playback = streamingStatus(user);
  const songs = get<{ total: number; playable: number }>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(preview_status != 'none'), 0) AS playable FROM songs WHERE user_id = ? AND ${IN_SELECTED_SOURCES}`,
    user.id,
  )!;
  const games = get<{ played: number; best: number | null; average: number | null; correct: number | null }>(
    `SELECT COUNT(*) AS played, MAX(score) AS best, AVG(score) AS average, SUM(correct_count) AS correct
     FROM game_sessions WHERE user_id = ? AND status = 'completed'`,
    user.id,
  )!;
  const rounds = get<{ total: number }>(
    `SELECT COUNT(*) AS total FROM game_rounds r JOIN game_sessions s ON s.id = r.session_id
     WHERE s.user_id = ? AND s.status = 'completed' AND r.result != 'skipped'`,
    user.id,
  )!;

  res.json({
    user: { id: user.id, displayName: user.display_name, email: user.email, lastSync: user.last_sync },
    stats: {
      songCount: songs.total,
      playableCount: playback.canStream ? songs.total : songs.playable,
      gamesPlayed: games.played,
      bestScore: games.best ?? 0,
      averageScore: games.average != null ? Math.round(games.average * 10) / 10 : 0,
      totalCorrect: games.correct ?? 0,
      totalRounds: rounds.total,
    },
    syncing: isSyncing(user.id),
    sourceCount: get<{ n: number }>('SELECT COUNT(*) AS n FROM user_sources WHERE user_id = ?', user.id)!.n,
    playback,
  });
});

// GET /api/user/spotify-token → Access Token für das Web Playback SDK im Browser
router.get('/spotify-token', async (req, res) => {
  const user = getUser(req.userId)!;
  try {
    res.json({ accessToken: await getValidAccessToken(user) });
  } catch (err) {
    console.error('[spotify-token]', (err as Error).message);
    res.status(502).json({ error: 'Spotify-Token konnte nicht erneuert werden – bitte neu anmelden' });
  }
});

export default router;
