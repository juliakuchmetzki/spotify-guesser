import type { CSSProperties } from 'react';
import type { SlotState } from '../types';
import { DIFFICULTIES } from '../utils/difficulty';

interface Props {
  /** Aktive Stufe (Index) */
  value: number;
  slots: readonly SlotState[];
  disabled?: boolean;
  onChange: (index: number) => void;
}

/** Fünf Pills, je eine pro Song: Rahmen + 15 % Hintergrund in der Stufenfarbe; aktive kräftig, erledigte abgeblendet mit Häkchen/Kreuz */
export default function DifficultySelector({ value, slots, disabled, onChange }: Props) {
  return (
    <div className="difficulty-pills" role="radiogroup" aria-label="Schwierigkeit">
      {DIFFICULTIES.map((d, i) => {
        const status = slots.find((s) => s.difficulty === i)?.status ?? 'pending';
        const done = status !== 'pending';
        return (
          <button
            key={d.id}
            type="button"
            role="radio"
            aria-checked={value === i}
            className={`difficulty-pill ${value === i ? 'is-active' : ''} ${done ? 'is-done' : ''}`}
            style={{ '--pill': d.color } as CSSProperties}
            disabled={disabled || done}
            onClick={() => onChange(i)}
          >
            {d.label}
            {done && <span aria-hidden="true"> {status === 'correct' ? '✓' : '✕'}</span>}
          </button>
        );
      })}
    </div>
  );
}
