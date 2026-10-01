import type { CSSProperties } from 'react';
import { DIFFICULTIES, type DifficultyId } from '../utils/difficulty';

interface Props {
  value: DifficultyId;
  onChange: (id: DifficultyId) => void;
}

/** Fünf Pills: aktive gefüllt, übrige als Outline in ihrer eigenen Farbe */
export default function DifficultySelector({ value, onChange }: Props) {
  return (
    <div className="difficulty-pills" role="radiogroup" aria-label="Schwierigkeit">
      {DIFFICULTIES.map((d) => (
        <button
          key={d.id}
          type="button"
          role="radio"
          aria-checked={value === d.id}
          className={`difficulty-pill ${value === d.id ? 'is-active' : ''}`}
          style={{ '--pill': d.color, '--pill-contrast': d.contrast } as CSSProperties}
          onClick={() => onChange(d.id)}
        >
          {d.label}
        </button>
      ))}
    </div>
  );
}
