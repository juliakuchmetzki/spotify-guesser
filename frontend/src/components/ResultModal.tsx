import { useEffect, useRef, useState } from 'react';
import type { SongAudio } from '../hooks/useSongAudio';
import type { RoundResult } from '../types';
import type { Difficulty } from '../utils/difficulty';
import { averageAttempts, type RoundStats } from '../utils/roundStats';
import ConfettiAnimation from './ConfettiAnimation';

interface Props {
  result: RoundResult;
  audio: SongAudio;
  gameOver: boolean;
  onNext: () => void;
  round: number;
  totalRounds: number;
  difficulty: Difficulty;
  /** Versuch (0-basiert), in dem die Runde endete */
  attempt: number;
  stats: RoundStats;
}

const HEADLINES: Record<RoundResult['outcome'], string> = {
  correct: 'Richtig!',
  failed: 'Leider nicht',
  gaveup: 'Aufgelöst',
};

const formatTime = (seconds: number) => {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

type Slot = 'skipped' | 'solved' | 'missed' | 'unused';

export default function ResultModal({
  result,
  audio,
  gameOver,
  onNext,
  round,
  totalRounds,
  difficulty,
  attempt,
  stats,
}: Props) {
  const { reveal, outcome } = result;
  const isCorrect = outcome === 'correct';
  const nextRef = useRef<HTMLButtonElement>(null);
  const isPlayingFull = audio.mode === 'full';
  const [shared, setShared] = useState(false);

  useEffect(() => {
    nextRef.current?.focus();
  }, []);

  // Nach einem Treffer läuft die ganze Preview direkt los
  useEffect(() => {
    if (isCorrect && audio.status === 'ready') void audio.playFull();
  }, [isCorrect, audio.status]);

  const handleNext = () => {
    audio.stop();
    onNext();
  };

  const slots: Slot[] = Array.from({ length: difficulty.stages }, (_, i) =>
    i < attempt ? 'skipped' : i === attempt ? (isCorrect ? 'solved' : 'missed') : 'unused',
  );

  const handleShare = async () => {
    const emoji: Record<Slot, string> = { skipped: '⬛', solved: '🟩', missed: '🟥', unused: '⬜' };
    const text = `Song Guesser #${round} · ${difficulty.label}\n${slots.map((s) => emoji[s]).join('')}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setShared(true);
      }
    } catch {
      /* Teilen abgebrochen */
    }
  };

  const progress = audio.duration > 0 ? (audio.position / audio.duration) * 100 : 0;
  const winRate = stats.played > 0 ? Math.round((stats.won / stats.played) * 100) : 0;
  const maxDist = Math.max(1, ...stats.dist);
  const average = averageAttempts(stats);
  const distRows = stats.dist.map((count, i) => ({
    label: i === stats.dist.length - 1 ? 'X' : String(i + 1),
    count,
    current: isCorrect ? i === attempt : i === stats.dist.length - 1,
  }));

  return (
    <div className="modal-overlay">
      {isCorrect && <ConfettiAnimation />}

      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="result-title">
        <p className={`result-eyebrow outcome-${outcome}`}>{HEADLINES[outcome]}</p>

        {reveal.imageUrl ? (
          <img src={reveal.imageUrl} alt="" className={`result-image ${isCorrect ? 'won' : ''}`} />
        ) : (
          <div className={`result-image placeholder ${isCorrect ? 'won' : ''}`} aria-hidden="true">
            ♪
          </div>
        )}

        <h2 id="result-title" className="result-title">
          {reveal.title}
        </h2>
        <p className="result-artist">{[reveal.artist, reveal.album].filter(Boolean).join(' — ')}</p>
        <a href={reveal.spotifyUrl} target="_blank" rel="noreferrer" className="result-link">
          Bei Spotify hören
        </a>

        {audio.status === 'ready' && (
          <div className="full-song-player">
            <button
              type="button"
              className="play-full-btn"
              onClick={() => (isPlayingFull ? audio.pauseFull() : void audio.playFull())}
              aria-label={isPlayingFull ? 'Pause' : 'Preview abspielen'}
            >
              {isPlayingFull ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z" />
                </svg>
              )}
            </button>
            <div className="full-song-progress">
              <div className="full-song-track">
                <div className="full-song-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="full-song-times">
                <span>{formatTime(audio.position)}</span>
                <span>{formatTime(audio.duration)}</span>
              </div>
            </div>
          </div>
        )}

        <p className={`result-points ${isCorrect ? '' : 'is-zero'}`}>
          {isCorrect ? `+${result.points} Punkte` : '0 Punkte'}
        </p>
        <div className="attempt-slots" aria-label={`Versuch ${attempt + 1} von ${difficulty.stages}`}>
          {slots.map((s, i) => (
            <span key={i} className={`attempt-slot is-${s}`} />
          ))}
        </div>

        <section className="result-stats" aria-labelledby="stats-title">
          <h3 id="stats-title" className="stats-heading">
            Gesamtwerte
          </h3>
          <dl className="stats-grid">
            <div>
              <dd>{stats.played}</dd>
              <dt>Gespielt</dt>
            </div>
            <div>
              <dd>{winRate}</dd>
              <dt>Gewonnen %</dt>
            </div>
            <div>
              <dd>{stats.streak}</dd>
              <dt>Serie</dt>
            </div>
            <div>
              <dd>{stats.best}</dd>
              <dt>Beste</dt>
            </div>
          </dl>

          <h3 className="stats-heading">Verteilung der Versuche</h3>
          <ol className="dist-chart">
            {distRows.map((row) => (
              <li key={row.label} className={row.current ? 'is-current' : ''}>
                <span className="dist-label">{row.label}</span>
                <span className="dist-track">
                  <span className="dist-bar" style={{ width: `${(row.count / maxDist) * 100}%` }} />
                </span>
                <span className="dist-count">{row.count}</span>
              </li>
            ))}
          </ol>
          <p className="stats-note">
            Du hast {winRate}% gelöst{average > 0 && ` · Ø ${average.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Versuche`}
          </p>
        </section>

        <button type="button" className="share-btn" onClick={() => void handleShare()}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
            <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
          </svg>
          {shared ? 'Kopiert!' : 'Teilen'}
        </button>

        <p className="result-footer">
          Runde {round} von {totalRounds}
        </p>
        <button ref={nextRef} type="button" className="btn-next" onClick={handleNext}>
          {gameOver ? 'Weiter: Ergebnis →' : 'Weiter: Nächster Song →'}
        </button>
      </div>
    </div>
  );
}
