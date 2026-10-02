import type { CSSProperties } from 'react';

export type BlockState = 'filled' | 'current' | 'empty' | 'correct' | 'failed';

interface Props {
  blocks: readonly { state: BlockState; color: string }[];
  label: string;
  /** Text hinter den Blöcken, z. B. „✓ Erraten“ */
  suffix?: string;
}

/** Reihe kleiner Balken (2 px hoch): gefüllt = erledigt, blass = offen, grün = erraten. */
export default function StatBlocks({ blocks, label, suffix }: Props) {
  return (
    <div className="stat-blocks" role="img" aria-label={suffix ? `${label} – ${suffix}` : label}>
      {blocks.map((b, i) => (
        <span key={i} className={`stat-block is-${b.state}`} style={{ '--block': b.color } as CSSProperties} />
      ))}
      {suffix && <span className="stat-suffix">{suffix}</span>}
    </div>
  );
}
