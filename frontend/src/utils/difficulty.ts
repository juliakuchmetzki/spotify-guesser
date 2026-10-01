import type { CSSProperties } from 'react';
import { SNIPPET_DURATIONS } from '../types';

export type DifficultyId = 'easy' | 'medium' | 'hard' | 'expert' | 'impossible';

export interface Difficulty {
  id: DifficultyId;
  label: string;
  color: string;
  /** Schrift auf gefüllten Flächen; auf Gelb wäre Weiß kaum lesbar */
  contrast: string;
  /** Anzahl freischaltbarer Snippet-Stufen (= Versuche) */
  stages: number;
}

export const DIFFICULTIES: readonly Difficulty[] = [
  { id: 'easy', label: 'Leicht', color: '#31C93A', contrast: '#ffffff', stages: SNIPPET_DURATIONS.length },
  { id: 'medium', label: 'Mittel', color: '#FFD700', contrast: '#0f1419', stages: 5 },
  { id: 'hard', label: 'Schwer', color: '#FF8C00', contrast: '#ffffff', stages: 4 },
  { id: 'expert', label: 'Experte', color: '#FF3333', contrast: '#ffffff', stages: 3 },
  { id: 'impossible', label: 'Unmöglich', color: '#9D4EDD', contrast: '#ffffff', stages: 2 },
];

export const GUESS_COLOR = '#31C93A';

const KEY = 'difficulty';

export function getDifficulty(id: DifficultyId): Difficulty {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[0];
}

export function loadDifficulty(): DifficultyId {
  try {
    const value = localStorage.getItem(KEY);
    return DIFFICULTIES.some((d) => d.id === value) ? (value as DifficultyId) : 'easy';
  } catch {
    return 'easy';
  }
}

export function saveDifficulty(id: DifficultyId) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ohne Speicher gilt die Wahl nur für diese Sitzung */
  }
}

/** Setzt die Akzentfarbe für alles darunter (siehe --accent in index.css) */
export const accentStyle = (d: Difficulty) =>
  ({ '--accent': d.color, '--accent-contrast': d.contrast }) as CSSProperties;
