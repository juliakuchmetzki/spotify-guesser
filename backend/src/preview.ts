/**
 * Spotify liefert für neu registrierte Apps (seit 27.11.2024) keine preview_url mehr.
 * Fallback: 30-Sekunden-Preview über die öffentliche Deezer-API, gesucht per ISRC,
 * notfalls per Artist + Titel. Deezer-Preview-URLs sind signiert und laufen ab, daher
 * wird nur die deezer_id gespeichert und die URL bei Bedarf frisch geholt.
 */
import { run, type SongRow } from './database';
import { fetchWithBackoff } from './spotify';
import { cleanTitle, normalize, splitArtists } from './text';

const DEEZER_API = 'https://api.deezer.com';

interface DeezerTrack {
  id: number;
  title: string;
  title_short?: string;
  preview?: string;
  rank?: number;
  artist?: { name: string };
}

interface DeezerError {
  error?: { code?: number; message?: string };
}

class TransientDeezerError extends Error {}

/** null = nicht gefunden; wirft bei vorübergehenden Fehlern (Quota, Netzwerk). */
async function deezer<T>(path: string): Promise<T | null> {
  const res = await fetchWithBackoff(`${DEEZER_API}${path}`, {}, 3);
  if (!res.ok) throw new TransientDeezerError(`Deezer HTTP ${res.status}`);
  const data = (await res.json()) as T & DeezerError;
  if (data.error) {
    // Code 4 = Quota überschritten (50 Requests / 5 s) → nicht als "keine Preview" werten
    if (data.error.code === 4) throw new TransientDeezerError(data.error.message);
    return null;
  }
  return data;
}

const VARIANT_WORDS = /\b(live|remix|edit|instrumental|karaoke|acoustic|cover|version|mix)\b/;

/** Wie gut passt ein Deezer-Treffer zum Song? 0 = gar nicht. */
function matchScore(track: DeezerTrack, song: SongRow, wantedArtist: string): number {
  if (!track.preview || normalize(track.artist?.name ?? '') !== wantedArtist) return 0;
  const title = normalize(track.title);
  if (title === normalize(song.title)) return 4;
  const wantedTitle = normalize(cleanTitle(song.title));
  if (normalize(track.title_short ?? cleanTitle(track.title)) !== wantedTitle) return 0;
  // Live-/Remix-Versionen nur nehmen, wenn nichts Besseres da ist
  const unwantedVariant = VARIANT_WORDS.test(title) && !VARIANT_WORDS.test(normalize(song.title));
  return unwantedVariant ? 1 : 3;
}

/** Freitextsuche (die erweiterte Syntax artist:"…" liefert bei Deezer oft nichts). */
async function searchDeezer(song: SongRow): Promise<DeezerTrack | null> {
  const artist = splitArtists(song.artist)[0] ?? song.artist;
  const q = encodeURIComponent(`${artist} ${cleanTitle(song.title)}`);
  const result = await deezer<{ data: DeezerTrack[] }>(`/search?q=${q}&limit=15`);
  const wantedArtist = normalize(artist);

  let best: DeezerTrack | null = null;
  let bestScore = 0;
  for (const track of result?.data ?? []) {
    const score = matchScore(track, song, wantedArtist);
    if (score > bestScore) [best, bestScore] = [track, score];
  }
  return best;
}

/** Liefert eine abspielbare Preview-URL oder null (Song wird dann als 'none' markiert). */
export async function resolvePreview(song: SongRow): Promise<string | null> {
  if (song.preview_url) return song.preview_url;
  if (song.preview_status === 'none') return null;

  try {
    let track = song.deezer_id ? await deezer<DeezerTrack>(`/track/${song.deezer_id}`) : null;
    if (!track?.preview && song.isrc) track = await deezer<DeezerTrack>(`/track/isrc:${encodeURIComponent(song.isrc)}`);
    if (!track?.preview) track = await searchDeezer(song);

    if (track?.preview) {
      run(
        "UPDATE songs SET deezer_id = ?, preview_status = 'deezer', deezer_rank = COALESCE(?, deezer_rank) WHERE id = ?",
        track.id,
        track.rank ?? null,
        song.id,
      );
      return track.preview;
    }
    run("UPDATE songs SET preview_status = 'none' WHERE id = ?", song.id);
    return null;
  } catch (err) {
    console.warn(`[preview] Song ${song.id} (${song.title}) konnte nicht aufgelöst werden:`, (err as Error).message);
    return null;
  }
}

/**
 * Deezer-Beliebtheit des Songs (höher = bekannter) – Grundlage der Schwierigkeitsstufen.
 * 0 = bei Deezer nicht gefunden; null = vorübergehender Fehler, später erneut versuchen.
 */
export async function ensureRank(song: SongRow): Promise<number | null> {
  if (song.deezer_rank != null) return song.deezer_rank;
  try {
    let track = song.deezer_id ? await deezer<DeezerTrack>(`/track/${song.deezer_id}`) : null;
    if (!track && song.isrc) track = await deezer<DeezerTrack>(`/track/isrc:${encodeURIComponent(song.isrc)}`);
    if (!track) track = await searchDeezer(song);
    const rank = track?.rank ?? 0;
    run('UPDATE songs SET deezer_rank = ? WHERE id = ?', rank, song.id);
    return rank;
  } catch (err) {
    console.warn(`[rank] Song ${song.id} (${song.title}) ohne Rank:`, (err as Error).message);
    return null;
  }
}
