export const SNIPPET_DURATIONS = [0.1, 0.5, 1, 2, 4, 8] as const;
export type SnippetDuration = (typeof SNIPPET_DURATIONS)[number];

export interface User {
  id: number;
  displayName: string | null;
  email: string | null;
  lastSync: string | null;
}

export interface UserStats {
  songCount: number;
  playableCount: number;
  gamesPlayed: number;
  bestScore: number;
  averageScore: number;
  totalCorrect: number;
  totalRounds: number;
}

export interface MeResponse {
  user: User;
  stats: UserStats;
  syncing: boolean;
  /** Song-Anfang über Spotify (Web Playback SDK) möglich? */
  playback: { canStream: boolean; reason?: 'scope' | 'premium' };
  /** Anzahl ausgewählter Quellen (Lieblingssongs/Playlists); 0 = Auswahl nötig */
  sourceCount: number;
}

export type PlaybackSource = 'preview' | 'start';

export interface Song {
  id: number;
  title: string;
  artist: string;
  album: string | null;
  imageUrl: string | null;
}

export interface SlotState {
  difficulty: number;
  status: 'pending' | 'correct' | 'failed';
  points: number;
}

export interface GameSession {
  id: number;
  /** Wievielter Song gerade dran ist (erledigte + 1) */
  round: number;
  totalRounds: number;
  /** Aktive Schwierigkeitsstufe (0 = Leicht … 4 = Unmöglich) – jede Stufe hat ihren eigenen Song */
  difficulty: number;
  slots: SlotState[];
  /** Fehlversuche beim aktiven Song (unbegrenzt) */
  wrongGuesses: number;
  score: number;
  correctCount: number;
  status: 'active' | 'completed' | 'abandoned';
  /** Ändert sich mit jedem neuen Song → Audio neu laden */
  trackToken: string | null;
}

export interface Reveal {
  title: string;
  artist: string;
  album: string | null;
  imageUrl: string | null;
  spotifyUrl: string;
}

export interface GuessResponse {
  correct: boolean;
  points: number;
  roundOver: boolean;
  reveal?: Reveal;
  state: GameSession;
}

export interface RoundResult {
  outcome: 'correct' | 'failed' | 'gaveup';
  points: number;
  reveal: Reveal;
  /** Längstes in dieser Runde abgespieltes Snippet (s), 0 = nichts gehört */
  heard: number;
}

export interface Highscore {
  sessionId: number;
  displayName: string;
  score: number;
  correctCount: number;
  finishedAt: string;
}

export interface HistoryEntry {
  id: number;
  score: number;
  correctCount: number;
  createdAt: string;
}

export const LIKED_SOURCE = 'liked';

export interface PlaylistInfo {
  id: string;
  name: string;
  imageUrl: string | null;
  trackCount: number;
  ownerName: string | null;
  /** Spotify gibt nur eigene oder gemeinsame Playlists frei */
  selectable: boolean;
  selected: boolean;
}

export interface SelectedSource {
  id: string;
  name: string;
  trackCount: number | null;
  syncedAt: string | null;
  error: string | null;
}

export interface PlaylistsResponse {
  missingScope: boolean;
  syncing: boolean;
  sources: SelectedSource[];
  playlists: PlaylistInfo[];
  liked: { selected: boolean };
}
