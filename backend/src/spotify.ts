import { run, type UserRow } from './database';

const ACCOUNTS_URL = 'https://accounts.spotify.com';
const API_URL = 'https://api.spotify.com/v1';
// streaming + user-read-private: Web Playback SDK ("Anfang"-Modus), user-modify-playback-state: Wiedergabe starten,
// playlist-read-*: eigene und gemeinsame Playlists als Song-Quellen
export const SCOPES =
  'user-library-read user-read-email user-read-private streaming user-modify-playback-state playlist-read-private playlist-read-collaborative';
export const STREAMING_SCOPES = ['streaming', 'user-read-private', 'user-modify-playback-state'];
export const PLAYLIST_SCOPES = ['playlist-read-private', 'playlist-read-collaborative'];

export function hasScopes(user: UserRow, scopes: string[]): boolean {
  const granted = (user.scopes ?? '').split(' ');
  return scopes.every((s) => granted.includes(s));
}

export class SpotifyError extends Error {
  constructor(public status: number, body: string) {
    super(`Spotify API ${status}: ${body}`);
  }
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export interface SpotifyProfile {
  id: string;
  display_name: string | null;
  /** Seit den Web-API-Änderungen vom Februar 2026 für neue Apps nicht mehr enthalten */
  email?: string;
  /** Seit Februar 2026 für neue Apps nicht mehr enthalten → Premium meldet das Web Playback SDK */
  product?: string;
}

interface SpotifyTrack {
  id: string | null;
  name: string;
  type?: string; // 'track' | 'episode'
  is_local: boolean;
  preview_url?: string | null;
  artists?: { name: string }[];
  album?: { name?: string; images?: { url: string; width: number | null }[] };
  external_ids?: { isrc?: string };
}

interface SavedTracksPage {
  items: { added_at: string; track: SpotifyTrack | null }[];
  next: string | null;
}

interface PlaylistItemsPage {
  // Seit Februar 2026 heißt das Feld "item"; "track" ist veraltet, wird aber als Rückfall gelesen
  items: { added_at: string; is_local?: boolean; item?: SpotifyTrack | null; track?: SpotifyTrack | null }[];
  next: string | null;
}

interface PlaylistsPage {
  items: {
    id: string;
    name: string;
    collaborative: boolean;
    images?: { url: string }[] | null;
    owner: { id: string; display_name?: string | null };
    items?: { total: number };
    tracks?: { total: number }; // veraltet
  }[];
  next: string | null;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  imageUrl: string | null;
  trackCount: number;
  ownerId: string;
  ownerName: string | null;
  collaborative: boolean;
}

export interface LikedTrack {
  spotifyId: string;
  title: string;
  artist: string;
  album: string | null;
  imageUrl: string | null;
  isrc: string | null;
  previewUrl: string | null;
  addedAt: string | null;
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Umgebungsvariable ${name} fehlt (siehe .env.example)`);
  return value;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const backoffDelay = (attempt: number) => 500 * 2 ** attempt + Math.random() * 250;

/** fetch mit Exponential Backoff bei Netzwerkfehlern, 429 (Retry-After wird respektiert) und 5xx. */
export async function fetchWithBackoff(url: string, init: RequestInit = {}, maxRetries = 5): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      await sleep(backoffDelay(attempt));
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : backoffDelay(attempt));
      continue;
    }
    return res;
  }
}

export function getAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env('SPOTIFY_CLIENT_ID'),
    scope: SCOPES,
    redirect_uri: env('SPOTIFY_REDIRECT_URI'),
    state,
  });
  return `${ACCOUNTS_URL}/authorize?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const basic = Buffer.from(`${env('SPOTIFY_CLIENT_ID')}:${env('SPOTIFY_CLIENT_SECRET')}`).toString('base64');
  const res = await fetchWithBackoff(`${ACCOUNTS_URL}/api/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new SpotifyError(res.status, await res.text());
  return (await res.json()) as TokenResponse;
}

export function exchangeCode(code: string): Promise<TokenResponse> {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: env('SPOTIFY_REDIRECT_URI') });
}

export function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

/** Liefert einen gültigen Access Token; erneuert ihn (und speichert ihn in der DB), wenn er bald abläuft. */
/**
 * Kann der User Songs über das Web Playback SDK hören? Geprüft werden nur die Scopes:
 * Den Abo-Typ liefert GET /me seit Februar 2026 nicht mehr – fehlt Premium, meldet das SDK
 * im Browser einen account_error bzw. das Starten der Wiedergabe schlägt mit 403 fehl.
 */
export function streamingStatus(user: UserRow): { canStream: boolean; reason?: 'scope' } {
  return hasScopes(user, STREAMING_SCOPES) ? { canStream: true } : { canStream: false, reason: 'scope' };
}

export async function getValidAccessToken(user: UserRow): Promise<string> {
  if (user.access_token && user.token_expires_at && user.token_expires_at > Date.now() + 60_000) {
    return user.access_token;
  }
  if (!user.refresh_token) throw new Error(`User ${user.id} hat keinen Refresh Token`);

  const tokens = await refreshAccessToken(user.refresh_token);
  const expiresAt = Date.now() + tokens.expires_in * 1000;
  run(
    'UPDATE users SET access_token = ?, token_expires_at = ?, refresh_token = COALESCE(?, refresh_token) WHERE id = ?',
    tokens.access_token,
    expiresAt,
    tokens.refresh_token ?? null,
    user.id,
  );
  return tokens.access_token;
}

async function spotifyGet<T>(urlOrPath: string, accessToken: string): Promise<T> {
  const url = urlOrPath.startsWith('http') ? urlOrPath : `${API_URL}${urlOrPath}`;
  const res = await fetchWithBackoff(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new SpotifyError(res.status, await res.text());
  return (await res.json()) as T;
}

/** Startet einen Track ab 0:00 auf dem Web-Playback-SDK-Gerät des Users. */
export async function startPlayback(accessToken: string, deviceId: string, spotifyTrackId: string): Promise<void> {
  const res = await fetchWithBackoff(`${API_URL}/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [`spotify:track:${spotifyTrackId}`], position_ms: 0 }),
  });
  if (!res.ok) throw new SpotifyError(res.status, await res.text());
}

export function getMe(accessToken: string): Promise<SpotifyProfile> {
  return spotifyGet<SpotifyProfile>('/me', accessToken);
}

/** Spotify-Track → gespeichertes Format; null für lokale Dateien, Podcasts & Co. */
function toTrackInfo(track: SpotifyTrack | null | undefined, addedAt: string | undefined): LikedTrack | null {
  if (!track?.id || track.is_local || (track.type && track.type !== 'track')) return null;
  // Felder können fehlen (undefined) – z. B. lässt Spotify preview_url bei neuen Apps ganz weg.
  // node:sqlite bindet undefined nicht, daher überall auf null normalisieren.
  const images = track.album?.images ?? [];
  return {
    spotifyId: track.id,
    title: track.name ?? 'Unbekannter Titel',
    artist: (track.artists ?? []).map((a) => a.name).join(', ') || 'Unbekannter Artist',
    album: track.album?.name ?? null,
    // Spotify sortiert Cover absteigend nach Größe – das mittlere (~300px) reicht.
    imageUrl: images[1]?.url ?? images[0]?.url ?? null,
    isrc: track.external_ids?.isrc ?? null,
    previewUrl: track.preview_url ?? null,
    addedAt: addedAt ?? null,
  };
}

/** Lädt alle Liked Songs des Users (Pagination mit limit=50). */
export async function getUserLikedTracks(accessToken: string): Promise<LikedTrack[]> {
  const tracks: LikedTrack[] = [];
  let next: string | null = '/me/tracks?limit=50&offset=0';

  while (next) {
    const page: SavedTracksPage = await spotifyGet<SavedTracksPage>(next, accessToken);
    for (const { added_at, track } of page.items) {
      const info = toTrackInfo(track, added_at);
      if (info) tracks.push(info);
    }
    next = page.next;
  }
  return tracks;
}

/**
 * Lädt alle Songs einer Playlist. Seit Februar 2026 nur für Playlists, die dem User gehören
 * oder an denen er mitarbeitet – sonst 403.
 */
export async function getPlaylistTracks(accessToken: string, playlistId: string): Promise<LikedTrack[]> {
  const tracks: LikedTrack[] = [];
  let next: string | null = `/playlists/${encodeURIComponent(playlistId)}/items?limit=50&offset=0&additional_types=track`;

  while (next) {
    const page: PlaylistItemsPage = await spotifyGet<PlaylistItemsPage>(next, accessToken);
    for (const entry of page.items) {
      if (entry.is_local) continue;
      const info = toTrackInfo(entry.item ?? entry.track, entry.added_at);
      if (info) tracks.push(info);
    }
    next = page.next;
  }
  return tracks;
}

/** Alle Playlists, die der User in seiner Bibliothek hat (eigene, gemeinsame und gefolgte). */
export async function getUserPlaylists(accessToken: string): Promise<SpotifyPlaylist[]> {
  const playlists: SpotifyPlaylist[] = [];
  let next: string | null = '/me/playlists?limit=50&offset=0';

  while (next) {
    const page: PlaylistsPage = await spotifyGet<PlaylistsPage>(next, accessToken);
    for (const p of page.items) {
      if (!p?.id) continue;
      playlists.push({
        id: p.id,
        name: p.name,
        imageUrl: p.images?.[0]?.url ?? null,
        trackCount: p.items?.total ?? p.tracks?.total ?? 0,
        ownerId: p.owner.id,
        ownerName: p.owner.display_name ?? null,
        collaborative: p.collaborative,
      });
    }
    next = page.next;
  }
  return playlists;
}
