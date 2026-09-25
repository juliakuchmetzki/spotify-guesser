import type { CSSProperties } from 'react';
import { formatDuration } from '../utils/format';

interface Props {
  lengths: readonly number[];
  currentIndex: number;
  isPlaying: boolean;
  /** Dauer des laufenden Clips (s) – so lange läuft die Füll-Animation */
  clipDuration: number;
  /** Wechselt bei jedem Abspielen → Animation startet von vorn */
  playId: number;
}

/**
 * Dicker Balken mit Strichen bei jeder Stufe. Grün = freigeschaltete Zeit (proportional).
 * Während der Wiedergabe füllt sich das Grün von links bis zur freigeschalteten Marke (reine CSS-Animation).
 */
export default function TimelineBar({ lengths, currentIndex, isPlaying, clipDuration, playId }: Props) {
  const max = lengths[lengths.length - 1];
  const current = lengths[currentIndex];
  const unlocked = (current / max) * 100;

  return (
    <div
      className="timeline-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={current}
      aria-valuetext={`${formatDuration(current)} von ${formatDuration(max)} freigeschaltet`}
      style={{ '--unlocked': `${unlocked}%` } as CSSProperties}
    >
      {/* Freigeschalteter Bereich; nur während der Wiedergabe sichtbar, wenn die Füllung noch nicht dort ist */}
      <div className="timeline-unlocked" />
      <div
        key={isPlaying ? `play-${playId}` : 'idle'}
        className={`timeline-played ${isPlaying ? 'is-filling' : ''}`}
        style={isPlaying ? ({ '--clip-duration': `${clipDuration}s` } as CSSProperties) : undefined}
      />
      {lengths.slice(0, -1).map((length) => (
        <span key={length} className="timeline-marker" style={{ left: `${(length / max) * 100}%` }} title={formatDuration(length)} />
      ))}
    </div>
  );
}
