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
}

export type PlaybackSource = 'preview' | 'start';

export interface Song {
  id: number;
  title: string;
  artist: string;
  album: string | null;
  imageUrl: string | null;
}

export interface GameSession {
  id: number;
  round: number;
  totalRounds: number;
  /** Fehlversuche in der aktuellen Runde (unbegrenzt) */
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
