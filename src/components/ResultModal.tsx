import { useEffect, useRef } from 'react';
import type { SongAudio } from '../hooks/useSongAudio';
import type { RoundResult } from '../types';
import { formatSeconds } from '../utils/format';
import ConfettiAnimation from './ConfettiAnimation';

interface Props {
  result: RoundResult;
  audio: SongAudio;
  gameOver: boolean;
  onNext: () => void;
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

export default function ResultModal({ result, audio, gameOver, onNext }: Props) {
  const { reveal, outcome } = result;
  const isCorrect = outcome === 'correct';
  const nextRef = useRef<HTMLButtonElement>(null);
  const isPlayingFull = audio.mode === 'full';

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

  const progress = audio.duration > 0 ? (audio.position / audio.duration) * 100 : 0;

  return (
    <div className="modal-overlay">
      {isCorrect && <ConfettiAnimation />}

      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="result-title">
        <p className={`result-eyebrow outcome-${outcome}`}>{HEADLINES[outcome]}</p>

        <div className="result-image-container">
          {reveal.imageUrl ? (
            <img src={reveal.imageUrl} alt="" className={`result-image ${isCorrect ? 'won' : ''}`} />
          ) : (
            <div className={`result-image placeholder ${isCorrect ? 'won' : ''}`} aria-hidden="true">
              ♪
            </div>
          )}
        </div>

        <div className="result-info">
          <h2 id="result-title" className="result-title">
            {reveal.title}
          </h2>
          <p className="result-artist">{reveal.artist}</p>
          {isCorrect && (
            <div className="result-badges">
              <span className="result-badge">
                {result.heard > 0 ? `Erraten in ${formatSeconds(result.heard)}` : 'Ohne reinzuhören erraten'}
              </span>
              <span className="result-badge filled">+{result.points} Punkte</span>
            </div>
          )}
        </div>

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

        <div className="modal-actions">
          <button ref={nextRef} type="button" className="btn-primary" onClick={handleNext}>
            {gameOver ? 'Ergebnis anzeigen' : 'Nächster Song'}
          </button>
          <a href={reveal.spotifyUrl} target="_blank" rel="noreferrer" className="btn-spotify">
            Auf Spotify öffnen
          </a>
        </div>
      </div>
    </div>
  );
}
