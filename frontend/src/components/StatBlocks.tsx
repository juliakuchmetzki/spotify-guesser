interface Props {
  /** Anzahl Versuche (Snippet-Längen) */
  total: number;
  /** Bereits übersprungene Versuche */
  skipped: number;
  /** Erraten: Reihe endet mit grünem Häkchen statt der offenen Blöcke */
  solved: boolean;
}

/** Eine zusammenhängende Reihe: ■■■□□□ (übersprungen / offen), nach der Lösung ■■■✓ */
export default function StatBlocks({ total, skipped, solved }: Props) {
  const label = solved ? `Erraten nach ${skipped} Mal überspringen` : `${skipped} von ${total} Versuchen übersprungen`;
  return (
    <div className="stat-blocks" role="img" aria-label={label}>
      {Array.from({ length: solved ? skipped : total }, (_, i) => (
        <span key={i} className={`stat-block ${i < skipped ? 'is-filled' : ''}`} />
      ))}
      {solved && <span className="stat-check">✓</span>}
    </div>
  );
}
