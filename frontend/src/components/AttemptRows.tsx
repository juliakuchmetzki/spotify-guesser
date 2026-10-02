import { formatDuration } from '../utils/format';

interface Props {
  lengths: readonly number[];
  /** Index der aktuell freigeschalteten Stufe = Anzahl bereits übersprungener Versuche */
  attempt: number;
  /** Erraten: aktuelle Zeile wird zur Erfolgs-Zeile */
  solved: boolean;
}

const SKIP_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 5v14l10-7zM19 5v14" />
  </svg>
);

/** Eine Zeile pro Versuch: übersprungen, aktuell (mit Länge) oder noch offen */
export default function AttemptRows({ lengths, attempt, solved }: Props) {
  return (
    <ol className="attempt-rows" aria-label="Versuche">
      {lengths.map((length, i) => {
        const state = i < attempt ? 'skipped' : i === attempt ? (solved ? 'solved' : 'current') : 'open';
        return (
          <li key={length} className={`attempt-row is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            {state === 'skipped' && (
              <>
                {SKIP_ICON}
                <span>Übersprungen</span>
              </>
            )}
            {state === 'current' && <span>Aktueller Versuch</span>}
            {state === 'solved' && <span>✓ Erraten</span>}
            <span className="attempt-length">{formatDuration(length)}</span>
          </li>
        );
      })}
    </ol>
  );
}
