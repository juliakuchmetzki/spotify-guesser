import { SNIPPET_DURATIONS } from '../types';
import type { DifficultyId } from './difficulty';

/** Lokale Rundenstatistik (nur dieser Browser – das Backend zählt Spiele, nicht Versuche) */
export interface RoundStats {
  played: number;
  won: number;
  streak: number;
  best: number;
  /** dist[i] = gelöst im Versuch i + 1; letzter Eintrag = nicht gelöst */
  dist: number[];
}

/** Je Schwierigkeit getrennt, damit Leicht und Unmöglich vergleichbar bleiben */
const key = (difficulty: DifficultyId) => `roundStats:${difficulty}`;
const SLOTS = SNIPPET_DURATIONS.length + 1;

const empty = (): RoundStats => ({ played: 0, won: 0, streak: 0, best: 0, dist: Array(SLOTS).fill(0) });

export function loadStats(difficulty: DifficultyId): RoundStats {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(difficulty)) ?? 'null') as RoundStats | null;
    if (!parsed || !Array.isArray(parsed.dist) || parsed.dist.length !== SLOTS) return empty();
    return parsed;
  } catch {
    return empty();
  }
}

/** attempt = Index des Versuchs, in dem gelöst wurde (0-basiert); null = nicht gelöst */
export function recordRound(difficulty: DifficultyId, attempt: number | null): RoundStats {
  const stats = loadStats(difficulty);
  const won = attempt != null;
  const dist = [...stats.dist];
  dist[won ? Math.min(attempt, SLOTS - 2) : SLOTS - 1]++;
  const streak = won ? stats.streak + 1 : 0;
  const next: RoundStats = {
    played: stats.played + 1,
    won: stats.won + (won ? 1 : 0),
    streak,
    best: Math.max(stats.best, streak),
    dist,
  };
  try {
    localStorage.setItem(key(difficulty), JSON.stringify(next));
  } catch {
    /* nicht speicherbar → gilt nur für diese Anzeige */
  }
  return next;
}

/** Ø Versuche bis zur Lösung (nur gelöste Runden) */
export function averageAttempts(stats: RoundStats): number {
  if (stats.won === 0) return 0;
  const sum = stats.dist.slice(0, -1).reduce((acc, n, i) => acc + n * (i + 1), 0);
  return sum / stats.won;
}
