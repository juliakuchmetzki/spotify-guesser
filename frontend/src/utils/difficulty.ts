import type { CSSProperties } from 'react';
import { SNIPPET_DURATIONS } from '../types';

export type DifficultyId = 'easy' | 'medium' | 'hard' | 'expert' | 'impossible';

export interface Difficulty {
  id: DifficultyId;
  label: string;
  color: string;
  /** Schrift auf gefüllten Flächen; auf Gelb/Orange wäre Weiß kaum lesbar */
  contrast: string;
  /** Anzahl freischaltbarer Snippet-Stufen (= Versuche); bei allen Graden gleich */
  stages: number;
}

export const DIFFICULTIES: readonly Difficulty[] = [
  { id: 'easy', label: 'Leicht', color: '#00AA00', contrast: '#ffffff', stages: SNIPPET_DURATIONS.length },
  { id: 'medium', label: 'Mittel', color: '#FFDD00', contrast: '#0f1419', stages: SNIPPET_DURATIONS.length },
  { id: 'hard', label: 'Schwer', color: '#FF8800', contrast: '#0f1419', stages: SNIPPET_DURATIONS.length },
  { id: 'expert', label: 'Experte', color: '#FF5555', contrast: '#ffffff', stages: SNIPPET_DURATIONS.length },
  { id: 'impossible', label: 'Unmöglich', color: '#BB55FF', contrast: '#ffffff', stages: SNIPPET_DURATIONS.length },
];

export const GUESS_COLOR = '#00AA00';

/** Index = Schwierigkeitsstufe des Backends (0 = Leicht … 4 = Unmöglich) */
export function difficultyAt(index: number): Difficulty {
  return DIFFICULTIES[index] ?? DIFFICULTIES[0];
}

/** Setzt die Akzentfarbe für alles darunter (siehe --accent in index.css) */
export const accentStyle = (d: Difficulty) =>
  ({ '--accent': d.color, '--accent-contrast': d.contrast }) as CSSProperties;
