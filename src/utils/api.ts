import axios from 'axios';
import type {
  GameSession,
  GuessResponse,
  Highscore,
  HistoryEntry,
  MeResponse,
  PlaylistsResponse,
  Song,
} from '../types';

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:5000';
export const LOGIN_URL = `${API_URL}/api/auth/login`;

const TOKEN_KEY = 'sgg_token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* Private Mode o. ä. – dann eben ohne Persistenz */
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignorieren */
  }
}

export const api = axios.create({ baseURL: `${API_URL}/api` });

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      clearToken();
      if (window.location.pathname !== '/login') window.location.assign('/login');
    }
    return Promise.reject(error);
  },
);

export function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data;
    if (data && typeof data === 'object' && 'error' in data) return String(data.error);
    if (!err.response) return 'Backend nicht erreichbar – läuft der Server auf Port 5000?';
    return err.message;
  }
  return err instanceof Error ? err.message : 'Unbekannter Fehler';
}

export const userApi = {
  me: () => api.get<MeResponse>('/user/me').then((r) => r.data),
  spotifyToken: () => api.get<{ accessToken: string }>('/user/spotify-token').then((r) => r.data.accessToken),
};

export const playlistApi = {
  list: () => api.get<PlaylistsResponse>('/playlists').then((r) => r.data),
  /** Auswahl speichern; die Songs werden danach im Hintergrund geladen */
  save: (sourceIds: string[]) => api.put('/playlists/selection', { sourceIds }),
};

export const songApi = {
  search: (q: string, signal?: AbortSignal) =>
    api.get<{ songs: Song[] }>('/songs/search', { params: { q }, signal }).then((r) => r.data.songs),
  sync: () => api.post('/songs/sync'),
};

export const gameApi = {
  active: () => api.get<{ state: GameSession | null }>('/games/active').then((r) => r.data.state),
  /** spotify = Audio kommt über das Web Playback SDK → auch Songs ohne Deezer-Preview sind möglich */
  start: (spotify = false) => api.post<{ state: GameSession }>('/games/start', { spotify }).then((r) => r.data.state),
  play: (sessionId: number, duration: number) =>
    api.post<{ state: GameSession }>('/games/play', { session_id: sessionId, duration }).then((r) => r.data.state),
  guess: (sessionId: number, guess: string, songId?: number) =>
    api
      .post<GuessResponse>('/games/guess', { session_id: sessionId, guess, song_id: songId })
      .then((r) => r.data),
  spotifyPlay: (sessionId: number, deviceId: string) =>
    api.post('/games/spotify-play', { session_id: sessionId, device_id: deviceId }),
  giveUp: (sessionId: number) =>
    api.post<GuessResponse>('/games/giveup', { session_id: sessionId }).then((r) => r.data),
  audio: (sessionId: number) =>
    api.get<ArrayBuffer>(`/games/${sessionId}/audio`, { responseType: 'arraybuffer' }).then((r) => r.data),
  highscores: () => api.get<{ highscores: Highscore[] }>('/games/highscores').then((r) => r.data.highscores),
  history: () => api.get<{ games: HistoryEntry[] }>('/games/history').then((r) => r.data.games),
};
