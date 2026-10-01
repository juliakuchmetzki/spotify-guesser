import { Router, type Request, type Response } from 'express';
import { all, get, getUser, IN_SELECTED_SOURCES, run, type SessionRow, type SongRow } from '../database';
import { resolvePreview } from '../preview';
import { getValidAccessToken, SpotifyError, startPlayback, streamingStatus } from '../spotify';
import { cleanTitle, normalize, splitArtists } from '../text';

export const TOTAL_ROUNDS = 5;
export const MAX_SKIPS = 3;
export const SNIPPET_DURATIONS = [0.1, 0.5, 1, 2, 4, 8];
const BASE_POINTS = 10;
const PENALTY_PER_WRONG_GUESS = 2;
const QUICK_BONUS = 5;
const QUICK_BONUS_MAX_SNIPPET = 0.5;
const PICK_ATTEMPTS = 15;

const router = Router();

/** Aufgelöste Preview-URL je Session, damit der Audio-Proxy nicht jedes Mal Deezer fragt. */
const previewCache = new Map<number, { songId: number; url: string }>();

function publicState(session: SessionRow) {
  return {
    id: session.id,
    round: session.round,
    totalRounds: TOTAL_ROUNDS,
    wrongGuesses: session.attempts, // unbegrenzt – kostet nur Punkte
    skipsLeft: MAX_SKIPS - session.skips_used,
    score: session.score,
    correctCount: session.correct_count,
    status: session.status,
    // Ändert sich bei jedem neuen Song, ohne die Song-ID preiszugeben
    trackToken: session.status === 'active' ? `${session.round}-${session.skips_used}` : null,
  };
}

function reveal(song: SongRow) {
  return {
    title: song.title,
    artist: song.artist,
    album: song.album,
    imageUrl: song.image_url,
    spotifyUrl: `https://open.spotify.com/track/${song.spotify_id}`,
  };
}

export function calculatePoints(wrongAttempts: number, maxSnippet: number): number {
  const base = Math.max(BASE_POINTS - PENALTY_PER_WRONG_GUESS * wrongAttempts, 0);
  return base + (maxSnippet <= QUICK_BONUS_MAX_SNIPPET ? QUICK_BONUS : 0);
}

/** Akzeptiert den Titel (mit oder ohne Zusätze wie "feat."/"Remastered"), optional kombiniert mit einem Artist. */
export function isCorrectGuess(guess: string, song: Pick<SongRow, 'title' | 'artist'>): boolean {
  const g = normalize(guess);
  if (!g) return false;
  const titles = new Set([normalize(song.title), normalize(cleanTitle(song.title))]);
  if (titles.has(g)) return true;

  const artists = [song.artist, ...splitArtists(song.artist)].map(normalize);
  for (const title of titles) {
    for (const artist of artists) {
      if (g === `${title} ${artist}` || g === `${artist} ${title}`) return true;
    }
  }
  return false;
}

function loadSession(req: Request, res: Response): SessionRow | undefined {
  const id = Number(req.body?.session_id ?? req.params.id);
  const session = get<SessionRow>('SELECT * FROM game_sessions WHERE id = ? AND user_id = ?', id, req.userId);
  if (!session) {
    res.status(404).json({ error: 'Spiel nicht gefunden' });
    return undefined;
  }
  if (session.status !== 'active') {
    res.status(409).json({ error: 'Dieses Spiel ist bereits beendet' });
    return undefined;
  }
  return session;
}

function currentSong(session: SessionRow): SongRow | undefined {
  return session.current_song_id != null
    ? get<SongRow>('SELECT * FROM songs WHERE id = ?', session.current_song_id)
    : undefined;
}

const reload = (id: number) => get<SessionRow>('SELECT * FROM game_sessions WHERE id = ?', id)!;

/**
 * Zufälliger, in dieser Session noch nicht gespielter Song.
 * Mit Spotify-Wiedergabe kommt jeder Liked Song infrage; sonst nur Songs mit abspielbarer Deezer-Preview.
 */
async function pickSong(sessionId: number, userId: number, spotifyPlayback: boolean): Promise<SongRow | null> {
  for (let i = 0; i < PICK_ATTEMPTS; i++) {
    const song = get<SongRow>(
      `SELECT * FROM songs
       WHERE user_id = ? AND ${IN_SELECTED_SOURCES} ${spotifyPlayback ? '' : "AND preview_status != 'none'"}
         AND id NOT IN (SELECT song_id FROM game_rounds WHERE session_id = ? AND song_id IS NOT NULL)
       ORDER BY RANDOM() LIMIT 1`,
      userId,
      sessionId,
    );
    if (!song) return null;
    if (spotifyPlayback) return song; // Preview wird nur noch fürs Ergebnis-Fenster/Rückfall bei Bedarf geladen
    const url = await resolvePreview(song);
    if (url) {
      previewCache.set(sessionId, { songId: song.id, url });
      return song;
    }
  }
  return null;
}

function recordRound(session: SessionRow, result: 'correct' | 'failed' | 'skipped', points: number) {
  run(
    'INSERT INTO game_rounds (session_id, song_id, round, attempts, max_snippet, points, result) VALUES (?, ?, ?, ?, ?, ?, ?)',
    session.id, session.current_song_id, session.round, session.attempts, session.max_snippet, points, result,
  );
}

function complete(sessionId: number) {
  run(
    "UPDATE game_sessions SET status = 'completed', current_song_id = NULL, finished_at = datetime('now') WHERE id = ?",
    sessionId,
  );
  previewCache.delete(sessionId);
}

/** Nächste Runde starten oder das Spiel beenden. */
async function advance(session: SessionRow): Promise<SessionRow> {
  const next =
    session.round < TOTAL_ROUNDS ? await pickSong(session.id, session.user_id, !!session.spotify_playback) : null;
  if (!next) {
    complete(session.id);
  } else {
    run(
      'UPDATE game_sessions SET round = round + 1, current_song_id = ?, attempts = 0, max_snippet = 0 WHERE id = ?',
      next.id,
      session.id,
    );
  }
  return reload(session.id);
}

// GET /api/games/active → laufendes Spiel des Users (zum Fortsetzen), sonst state: null
router.get('/active', (req, res) => {
  const session = get<SessionRow>(
    "SELECT * FROM game_sessions WHERE user_id = ? AND status = 'active' AND current_song_id IS NOT NULL ORDER BY id DESC LIMIT 1",
    req.userId,
  );
  res.json({ state: session ? publicState(session) : null });
});

// POST /api/games/start { spotify?: boolean } → neue Session mit zufälligem ersten Song
router.post('/start', async (req, res) => {
  run("UPDATE game_sessions SET status = 'abandoned' WHERE user_id = ? AND status = 'active'", req.userId);

  // Nur wenn der User wirklich über Spotify hören kann, sind Songs ohne Deezer-Preview erlaubt
  const spotifyPlayback = req.body?.spotify === true && streamingStatus(getUser(req.userId)!).canStream;
  const { lastInsertRowid: sessionId } = run(
    'INSERT INTO game_sessions (user_id, spotify_playback) VALUES (?, ?)',
    req.userId,
    spotifyPlayback ? 1 : 0,
  );
  const song = await pickSong(sessionId, req.userId, spotifyPlayback);
  if (!song) {
    run('DELETE FROM game_sessions WHERE id = ?', sessionId);
    return res.status(409).json({
      error: 'Keine abspielbaren Songs in deinen ausgewählten Playlists. Wähle weitere Playlists oder synchronisiere erneut.',
    });
  }
  run('UPDATE game_sessions SET current_song_id = ? WHERE id = ?', song.id, sessionId);
  res.status(201).json({ state: publicState(reload(sessionId)) });
});

// POST /api/games/play { session_id, duration } → merkt sich das längste gehörte Snippet (für den Bonus)
router.post('/play', (req, res) => {
  const session = loadSession(req, res);
  if (!session) return;
  const duration = Number(req.body.duration);
  if (!SNIPPET_DURATIONS.includes(duration)) return res.status(400).json({ error: 'Ungültige Snippet-Länge' });

  run('UPDATE game_sessions SET max_snippet = MAX(max_snippet, ?) WHERE id = ?', duration, session.id);
  res.json({ state: publicState(reload(session.id)) });
});

// POST /api/games/guess { session_id, guess, song_id? }
router.post('/guess', async (req, res) => {
  const session = loadSession(req, res);
  if (!session) return;
  const song = currentSong(session);
  if (!song) return res.status(409).json({ error: 'Kein aktiver Song' });

  const guess = typeof req.body.guess === 'string' ? req.body.guess.trim() : '';
  const guessedSongId = req.body.song_id != null ? Number(req.body.song_id) : null;
  if (!guess && guessedSongId == null) return res.status(400).json({ error: 'Bitte einen Tipp eingeben' });

  let correct: boolean;
  if (guessedSongId != null) {
    // Auswahl aus der Autocomplete-Liste: gleicher Song oder andere Version mit gleichem Titel + Artist
    const picked = get<SongRow>('SELECT * FROM songs WHERE id = ? AND user_id = ?', guessedSongId, req.userId);
    correct =
      guessedSongId === song.id ||
      (!!picked &&
        normalize(cleanTitle(picked.title)) === normalize(cleanTitle(song.title)) &&
        normalize(splitArtists(picked.artist)[0] ?? '') === normalize(splitArtists(song.artist)[0] ?? ''));
  } else {
    correct = isCorrectGuess(guess, song);
  }

  if (correct) {
    const points = calculatePoints(session.attempts, session.max_snippet);
    run('UPDATE game_sessions SET score = score + ?, correct_count = correct_count + 1 WHERE id = ?', points, session.id);
    recordRound(session, 'correct', points);
    const state = await advance(reload(session.id));
    return res.json({ correct: true, points, roundOver: true, reveal: reveal(song), state: publicState(state) });
  }

  // Versuche sind unbegrenzt; jeder Fehlversuch senkt nur die möglichen Punkte
  run('UPDATE game_sessions SET attempts = attempts + 1 WHERE id = ?', session.id);
  res.json({ correct: false, points: 0, roundOver: false, state: publicState(reload(session.id)) });
});

// POST /api/games/giveup { session_id } → Runde ohne Punkte beenden und Lösung zeigen
router.post('/giveup', async (req, res) => {
  const session = loadSession(req, res);
  if (!session) return;
  const song = currentSong(session);
  if (!song) return res.status(409).json({ error: 'Kein aktiver Song' });

  recordRound(session, 'failed', 0);
  const state = await advance(session);
  res.json({ correct: false, points: 0, roundOver: true, reveal: reveal(song), state: publicState(state) });
});

// POST /api/games/skip { session_id } → ersetzt den Song der aktuellen Runde (max. MAX_SKIPS pro Spiel)
router.post('/skip', async (req, res) => {
  const session = loadSession(req, res);
  if (!session) return;
  if (session.skips_used >= MAX_SKIPS) return res.status(400).json({ error: 'Keine Skips mehr übrig' });
  const song = currentSong(session);
  if (!song) return res.status(409).json({ error: 'Kein aktiver Song' });

  recordRound(session, 'skipped', 0);
  const next = await pickSong(session.id, session.user_id, !!session.spotify_playback);
  if (next) {
    run(
      'UPDATE game_sessions SET skips_used = skips_used + 1, current_song_id = ?, attempts = 0, max_snippet = 0 WHERE id = ?',
      next.id,
      session.id,
    );
  } else {
    run('UPDATE game_sessions SET skips_used = skips_used + 1 WHERE id = ?', session.id);
    complete(session.id);
  }
  res.json({ reveal: reveal(song), state: publicState(reload(session.id)) });
});

// POST /api/games/playback { session_id, spotify } → Wiedergabeart des laufenden Spiels ändern.
// Ohne Spotify kommen ab dem nächsten Song nur noch Songs mit Deezer-Preview dran.
router.post('/playback', (req, res) => {
  const session = loadSession(req, res);
  if (!session) return;
  const spotify = req.body?.spotify === true && streamingStatus(getUser(req.userId)!).canStream;
  run('UPDATE game_sessions SET spotify_playback = ? WHERE id = ?', spotify ? 1 : 0, session.id);
  res.json({ spotify });
});

// POST /api/games/spotify-play { session_id, device_id } → aktuellen Song ab 0:00 im Web Playback SDK starten
router.post('/spotify-play', async (req, res) => {
  const session = loadSession(req, res);
  if (!session) return;
  const song = currentSong(session);
  if (!song) return res.status(409).json({ error: 'Kein aktiver Song' });
  const deviceId = typeof req.body.device_id === 'string' ? req.body.device_id : '';
  if (!deviceId) return res.status(400).json({ error: 'device_id fehlt' });

  try {
    await startPlayback(await getValidAccessToken(getUser(req.userId)!), deviceId, song.spotify_id);
    res.status(204).end();
  } catch (err) {
    const status = err instanceof SpotifyError ? err.status : 0;
    console.error('[spotify-play]', (err as Error).message);
    if (status === 403) return res.status(403).json({ error: 'Für den Song-Anfang brauchst du Spotify Premium' });
    if (status === 404) return res.status(409).json({ error: 'Spotify-Player im Browser nicht gefunden – Seite neu laden' });
    res.status(502).json({ error: 'Spotify-Wiedergabe konnte nicht gestartet werden' });
  }
});

// GET /api/games/:id/audio → Preview des aktuellen Songs (proxied, damit Web Audio keine CORS-Probleme hat)
router.get('/:id/audio', async (req, res) => {
  const session = loadSession(req, res);
  if (!session) return;
  const song = currentSong(session);
  if (!song) return res.status(409).json({ error: 'Kein aktiver Song' });

  const fetchAudio = async (forceResolve: boolean) => {
    const cached = previewCache.get(session.id);
    let url = !forceResolve && cached?.songId === song.id ? cached.url : await resolvePreview(song);
    if (!url) return null;
    previewCache.set(session.id, { songId: song.id, url });
    const upstream = await fetch(url);
    return upstream.ok ? upstream : null;
  };

  // Signierte Deezer-URLs können ablaufen → einmal neu auflösen
  const upstream = (await fetchAudio(false)) ?? (await fetchAudio(true));
  if (!upstream) return res.status(502).json({ error: 'Preview konnte nicht geladen werden – bitte Song überspringen' });

  res.set('Content-Type', upstream.headers.get('content-type') ?? 'audio/mpeg');
  res.set('Cache-Control', 'no-store');
  res.send(Buffer.from(await upstream.arrayBuffer()));
});

// GET /api/games/highscores → Top 10 aller User
router.get('/highscores', (_req, res) => {
  const rows = all<{ id: number; display_name: string | null; score: number; correct_count: number; finished_at: string }>(
    `SELECT s.id, u.display_name, s.score, s.correct_count, s.finished_at
     FROM game_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.status = 'completed'
     ORDER BY s.score DESC, s.finished_at ASC LIMIT 10`,
  );
  res.json({
    highscores: rows.map((r) => ({
      sessionId: r.id,
      displayName: r.display_name ?? 'Unbekannt',
      score: r.score,
      correctCount: r.correct_count,
      finishedAt: r.finished_at,
    })),
  });
});

// GET /api/games/history → letzte Spiele des Users
router.get('/history', (req, res) => {
  const rows = all<{ id: number; score: number; correct_count: number; status: string; created_at: string }>(
    `SELECT id, score, correct_count, status, created_at FROM game_sessions
     WHERE user_id = ? AND status = 'completed' ORDER BY created_at DESC, id DESC LIMIT 20`,
    req.userId,
  );
  res.json({
    games: rows.map((r) => ({ id: r.id, score: r.score, correctCount: r.correct_count, createdAt: r.created_at })),
  });
});

export default router;
