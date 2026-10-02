import type { RoundResult } from '../types';
import { SNIPPET_DURATIONS } from '../types';
import { formatSeconds } from '../utils/format';

/** Abgeschlossene Stufe: was gespielt wurde und wie es ausging (wird pro Spiel im Browser gemerkt) */
export interface FinishedSlot {
  outcome: RoundResult['outcome'];
  points: number;
  reveal: RoundResult['reveal'];
  /** Anzahl Versuche, die übersprungen wurden, bevor die Runde endete */
  attempt: number;
  /** Falsche Tipps (Freitext) */
  wrong: string[];
}

interface Props {
  slot: FinishedSlot;
  onBack: () => void;
}

const SKIP_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 5v14l10-7zM19 5v14" />
  </svg>
);

/** Nur-Lesen-Ansicht eines bereits beendeten Songs: Cover, Titel und der Weg dorthin */
export default function SongReview({ slot, onBack }: Props) {
  const { reveal, outcome, attempt, wrong, points } = slot;
  const solved = outcome === 'correct';
  const summary = solved
    ? attempt === 0
      ? 'Direkt beim ersten Versuch erraten'
      : `Nach ${attempt} Mal Überspringen erraten (${formatSeconds(SNIPPET_DURATIONS[Math.min(attempt, SNIPPET_DURATIONS.length - 1)])} gehört)`
    : outcome === 'gaveup'
      ? 'Aufgegeben'
      : 'Nicht erraten';

  return (
    <section className="song-review">
      {reveal.imageUrl ? (
        <img className="review-cover" src={reveal.imageUrl} alt="" />
      ) : (
        <div className="review-cover review-cover-empty">♪</div>
      )}
      <div className="review-text">
        <h2>{reveal.title}</h2>
        <p>{reveal.artist}</p>
      </div>
      <p className={`review-summary ${solved ? 'is-solved' : ''}`}>
        {summary}
        {solved && points > 0 && ` · ${points} Punkte`}
      </p>

      <ol className="attempt-rows" aria-label="Verlauf">
        {Array.from({ length: attempt }, (_, i) => (
          <li key={`skip-${i}`} className="attempt-row is-skipped">
            {SKIP_ICON}
            <span>Übersprungen</span>
          </li>
        ))}
        {wrong.map((guess, i) => (
          <li key={`wrong-${i}`} className="attempt-row is-wrong">
            <span>✕ {guess}</span>
          </li>
        ))}
        {solved && (
          <li className="attempt-row is-solved">
            <span>✓ {reveal.title}</span>
          </li>
        )}
      </ol>

      <div className="review-actions">
        {reveal.spotifyUrl && (
          <a className="button button-secondary" href={reveal.spotifyUrl} target="_blank" rel="noreferrer">
            In Spotify öffnen
          </a>
        )}
        <button type="button" className="button button-primary" onClick={onBack}>
          Zurück zum Spiel
        </button>
      </div>
    </section>
  );
}
