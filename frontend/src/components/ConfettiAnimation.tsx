import { useEffect, useMemo, useState, type CSSProperties } from 'react';

const PIECES = 60;
const COLORS = ['var(--color-primary)', 'var(--color-accent)', 'var(--color-text-primary)', 'var(--color-primary-light)'];
const LIFETIME_MS = 3200;

/** Einmaliges Konfetti (rein CSS-animiert), entfernt sich nach ~3 s selbst. */
export default function ConfettiAnimation() {
  const [visible, setVisible] = useState(true);

  // Zufallswerte einmal erzeugen, damit Re-Renders das Konfetti nicht neu verteilen
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.3,
        duration: 2 + Math.random(),
        drift: (Math.random() - 0.5) * 160,
        spin: 360 + Math.random() * 720,
        size: 6 + Math.random() * 6,
        color: COLORS[i % COLORS.length],
        round: Math.random() > 0.5,
      })),
    [],
  );

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), LIFETIME_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className="confetti-container" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className={`confetti ${p.round ? 'round' : ''}`}
          style={
            {
              left: `${p.left}%`,
              width: `${p.size}px`,
              height: `${p.round ? p.size : p.size * 0.45}px`,
              background: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              '--drift': `${p.drift}px`,
              '--spin': `${p.spin}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
