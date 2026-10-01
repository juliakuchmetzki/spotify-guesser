import { Router, type Request, type Response } from 'express';
import {
  all,
  get,
  getUser,
  IN_SELECTED_SOURCES,
  run,
  transaction,
  type SessionRow,
  type SlotRow,
  type SongRow,
} from '../database';
import { ensureRank, resolvePreview } from '../preview';
import { getValidAccessToken, SpotifyError, startPlayback, streamingStatus } from '../spotify';
import { cleanTitle, normalize, splitArtists } from '../text';

/** Ein Song pro Schwierigkeitsstufe: 0 = Leicht … 4 = Unmöglich */
export const DIFFICULTY_COUNT = 5;
export const TOTAL_ROUNDS = DIFFICULTY_COUNT;
export const SNIPPET_DURATIONS = [0.1, 0.5, 1, 2, 4, 8];
const BASE_POINTS = 10;
const PENALTY_PER_WRONG_GUESS = 2;
const QUICK_BONUS = 5;
const QUICK_BONUS_MAX_SNIPPET = 0.5;
/** So viele Songs werden gesichtet (Rank prüfen), bevor sie in fünf Stufen eingeteilt werden */
const SAMPLE_SIZE = 30;
const RANK_LOOKUPS_AT_ONCE = 5;

const router = Router();

/** Aufgelöste Preview-URL je Session, damit der Audio-Proxy nicht jedes Mal Deezer fragt. */
const previewCache = new Map<number, { songId: number; url: string }>();

const slotsOf = (sessionId: number) =>
  all<SlotRow>('SELECT * FROM game_slots WHERE session_id = ? ORDER BY difficulty', sessionId);

const slotOf = (sessionId: number, difficulty: number) =>
  get<SlotRow>('SELECT * FROM game_slots WHERE session_id = ? AND difficulty = ?', sessionId, difficulty);

function publicState(session: SessionRow) {
  const slots = slotsOf(session.id);
  const active = slots.find((s) => s.difficulty === session.difficulty);
  return {
    id: session.id,
    // Wie vielter Song gerade dran ist (erledigte + 1), nie mehr als die Gesamtzahl
    round: Math.min(slots.filter((s) => s.status !== 'pending').length + 1, TOTAL_ROUNDS),
    totalRounds: TOTAL_ROUNDS,
    difficulty: session.difficulty,
    slots: slots.map((s) => ({ difficulty: s.difficulty, status: s.status, points: s.points })),
    wrongGuesses: active?.attempts ?? 0, // unbegrenzt – kostet nur Punkte
    score: session.score,
    correctCount: session.correct_count,
    status: session.status,
    // Ändert sich bei jedem Wechsel der Stufe, ohne die Song-ID preiszugeben
    trackToken: session.status === 'active' ? `${session.id}-${session.difficulty}` : null,
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

const shuffle = <T>(items: T[]): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/**
 * Wählt fünf Songs, einen je Schwierigkeitsstufe: Eine Stichprobe wird nach Deezer-Beliebtheit sortiert
 * und in fünf gleich große Gruppen geteilt (bekannteste = Leicht, unbekannteste = Unmöglich).
 * Mit Spotify-Wiedergabe kommt jeder Song infrage; sonst nur Songs mit abspielbarer Deezer-Preview.
 */
async function pickSongSet(sessionId: number, userId: number, spotifyPlayback: boolean): Promise<SongRow[] | null> {
  const pool = all<SongRow>(
    `SELECT * FROM songs WHERE user_id = ? AND ${IN_SELECTED_SOURCES} ${spotifyPlayback ? '' : "AND preview_status != 'none'"}`,
    userId,
  );
  if (pool.length < DIFFICULTY_COUNT) return null;

  // Schon bewertete Songs zuerst (kosten nichts), unbewertete nur so viele wie nötig
  const rated = shuffle(pool.filter((s) => s.deezer_rank != null));
  const unrated = shuffle(pool.filter((s) => s.deezer_rank == null));
  const sample = [...rated, ...unrated.slice(0, Math.max(SAMPLE_SIZE - rated.length, 0))].slice(0, SAMPLE_SIZE);
  const toRate = sample.filter((s) => s.deezer_rank == null);
  for (let i = 0; i < toRate.length; i += RANK_LOOKUPS_AT_ONCE) {
    await Promise.all(
      toRate.slice(i, i + RANK_LOOKUPS_AT_ONCE).map(async (song) => {
        song.deezer_rank = await ensureRank(song);
      }),
    );
  }

  // Ohne Rank (nicht gefunden / Fehler) → ans Ende, damit sie höchstens die schwersten Stufen füllen
  const known = sample.filter((s) => (s.deezer_rank ?? 0) > 0).sort((a, b) => b.deezer_rank! - a.deezer_rank!);
  const ordered = [...known, ...shuffle(sample.filter((s) => (s.deezer_rank ?? 0) <= 0))];

  const picked: SongRow[] = [];
  for (let level = 0; level < DIFFICULTY_COUNT; level++) {
    const from = Math.floor((level * ordered.length) / DIFFICULTY_COUNT);
    const to = Math.floor(((level + 1) * ordered.length) / DIFFICULTY_COUNT);
    let chosen: SongRow | null = null;
    for (const song of shuffle(ordered.slice(from, to))) {
      if (spotifyPlayback) {
        chosen = song;
        break;
      }
      const url = await resolvePreview(song);
      if (url) {
        chosen = song;
        if (level === 0) previewCache.set(sessionId, { songId: song.id, url });
        break;
      }
    }
    if (!chosen) return null;
    picked.push(chosen);
  }
  return picked;
}

/** Macht die Stufe zur aktiven (und ihren Song zum aktuellen Song der Session). */
function activate(sessionId: number, slot: SlotRow) {
  run('UPDATE game_sessions SET difficulty = ?, current_song_id = ? WHERE id = ?', slot.difficulty, slot.song_id, sessionId);
}

function recordRound(session: SessionRow, slot: SlotRow, result: 'correct' | 'failed', points: number) {
  const round = slotsOf(session.id).filter((s) => s.status !== 'pending').length + 1;
  run(
    'INSERT INTO game_rounds (session_id, song_id, round, attempts, max_snippet, points, result) VALUES (?, ?, ?, ?, ?, ?, ?)',
    session.id, slot.song_id, round, slot.attempts, slot.max_snippet, points, result,
  );
}

function complete(sessionId: number) {
  run(
    "UPDATE game_sessions SET status = 'completed', current_song_id = NULL, finished_at = datetime('now') WHERE id = ?",
    sessionId,
  );
  previewCache.delete(sessionId);
}

/** Schließt die aktive Stufe ab und springt zur leichtesten noch offenen – oder beendet das Spiel. */
function finishSlot(session: SessionRow, slot: SlotRow, status: 'correct' | 'failed', points: number): SessionRow {
  transaction(() => {
    recordRound(session, slot, status, points);
    run(
      'UPDATE game_slots SET status = ?, points = ? WHERE session_id = ? AND difficulty = ?',
      status, points, session.id, slot.difficulty,
    );
    if (status === 'correct') {
      run('UPDATE game_sessions SET score = score + ?, correct_count = correct_count + 1 WHERE id = ?', points, session.id);
    }
    const next = slotsOf(session.id).find((s) => s.status === 'pending');
    if (next) activate(session.id, next);
    else complete(session.id);
  });
  return reload(session.id);
}

// GET /api/games/active → laufendes Spiel des Users (zum Fortsetzen), sonst state: null
router.get('/active', (req, res) => {
  // Spiele aus der Zeit vor den Schwierigkeitsstufen (ohne Slots) lassen sich nicht fortsetzen
  const session = get<SessionRow>(
    `SELECT * FROM game_sessions WHERE user_id = ? AND status = 'active' AND current_song_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM game_slots WHERE session_id = game_sessions.id)
     ORDER BY id DESC LIMIT 1`,
    req.userId,
  );
  res.json({ state: session ? publicState(session) : null });
});

// POST /api/games/start { spotify?: boolean } → neue Session mit fünf Songs (je Schwierigkeitsstufe einer)
router.post('/start', async (req, res) => {
  run("UPDATE game_sessions SET status = 'abandoned' WHERE user_id = ? AND status = 'active'", req.userId);

  // Nur wenn der User wirklich über Spotify hören kann, sind Songs ohne Deezer-Preview erlaubt
  const spotifyPlayback = req.body?.spotify === true && streamingStatus(getUser(req.userId)!).canStream;
  const { lastInsertRowid: sessionId } = run(
    'INSERT INTO game_sessions (user_id, spotify_playback) VALUES (?, ?)',
    req.userId,
    spotifyPlayback ? 1 : 0,
  );
  const songs = await pickSongSet(sessionId, req.userId, spotifyPlayback);
  if (!songs) {
    run('DELETE FROM game_sessions WHERE id = ?', sessionId);
    return res.status(409).json({
      error: `Für ein Spiel braucht es mindestens ${DIFFICULTY_COUNT} abspielbare Songs in deinen ausgewählten Playlists. Wähle weitere Playlists oder synchronisiere erneut.`,
    });
  }
  transaction(() => {
    songs.forEach((song, difficulty) =>
      run('INSERT INTO game_slots (session_id, difficulty, song_id) VALUES (?, ?, ?)', sessionId, difficulty, song.id),
    );
    activate(sessionId, slotOf(sessionId, 0)!);
  });
  res.status(201).json({ state: publicState(reload(sessionId)) });
});

// POST /api/games/play { session_id, duration } → merkt sich das längste gehörte Snippet (für den Bonus)
router.post('/play', (req, res) => {
  const session = loadSession(req, res);
  if (!session) return;
  const duration = Number(req.body.duration);
  if (!SNIPPET_DURATIONS.includes(duration)) return res.status(400).json({ error: 'Ungültige Snippet-Länge' });

  run(
    'UPDATE game_slots SET max_snippet = MAX(max_snippet, ?) WHERE session_id = ? AND difficulty = ?',
    duration, session.id, session.difficulty,
  );
  res.json({ state: publicState(reload(session.id)) });
});

// POST /api/games/guess { session_id, guess, song_id? }
router.post('/guess', async (req, res) => {
  const session = loadSession(req, res);
  if (!session) return;
  const song = currentSong(session);
  const slot = slotOf(session.id, session.difficulty);
  if (!song || !slot) return res.status(409).json({ error: 'Kein aktiver Song' });

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
    const points = calculatePoints(slot.attempts, slot.max_snippet);
    const state = finishSlot(session, slot, 'correct', points);
    return res.json({ correct: true, points, roundOver: true, reveal: reveal(song), state: publicState(state) });
  }

  // Versuche sind unbegrenzt; jeder Fehlversuch senkt nur die möglichen Punkte
  run('UPDATE game_slots SET attempts = attempts + 1 WHERE session_id = ? AND difficulty = ?', session.id, session.difficulty);
  res.json({ correct: false, points: 0, roundOver: false, state: publicState(reload(session.id)) });
});

// POST /api/games/giveup { session_id } → Song ohne Punkte beenden und Lösung zeigen
router.post('/giveup', async (req, res) => {
  const session = loadSession(req, res);
  if (!session) return;
  const song = currentSong(session);
  const slot = slotOf(session.id, session.difficulty);
  if (!song || !slot) return res.status(409).json({ error: 'Kein aktiver Song' });

  const state = finishSlot(session, slot, 'failed', 0);
  res.json({ correct: false, points: 0, roundOver: true, reveal: reveal(song), state: publicState(state) });
});

// POST /api/games/switch { session_id, difficulty } → zu einer noch offenen Stufe wechseln (Fortschritt der anderen bleibt)
router.post('/switch', (req, res) => {
  const session = loadSession(req, res);
  if (!session) return;
  const difficulty = Number(req.body.difficulty);
  const slot = Number.isInteger(difficulty) ? slotOf(session.id, difficulty) : undefined;
  if (!slot) return res.status(400).json({ error: 'Ungültige Schwierigkeit' });
  if (slot.status !== 'pending') return res.status(409).json({ error: 'Dieser Song ist schon erledigt' });

  activate(session.id, slot);
  res.json({ state: publicState(reload(session.id)) });
});

// POST /api/games/playback { session_id, spotify } → Wiedergabeart des laufenden Spiels ändern.
// Die fünf Songs stehen schon fest; fehlt einem die Preview, meldet /audio das und der Spieler gibt auf oder wechselt.
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
  if (!upstream) return res.status(502).json({ error: 'Preview konnte nicht geladen werden – bitte wechsle die Stufe oder gib den Song auf' });

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
