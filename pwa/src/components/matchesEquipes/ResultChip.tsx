import { ISSUE_LABEL, ISSUE_LETTER, type ResultIssue } from './result';
import './matchesEquipes.css';

/**
 * Puce d'issue V / D / N. `sm` : lettre visible, mot entier pour le lecteur d'écran et en
 * infobulle. `lg` : mot entier visible. `decorative` quand le parent annonce déjà l'issue
 * (ligne de liste avec `aria-label`), pour ne pas la faire lire deux fois.
 */
export function ResultChip({ issue, size = 'sm', decorative = false }: {
  issue: ResultIssue;
  size?: 'sm' | 'lg';
  decorative?: boolean;
}) {
  const label = ISSUE_LABEL[issue];
  const className = `res-chip ${issue}${size === 'lg' ? ' lg' : ''}`;
  if (size === 'lg') return <span className={className} aria-hidden={decorative || undefined}>{label}</span>;
  return (
    <span className={className} title={label} aria-hidden={decorative || undefined}>
      <span aria-hidden="true">{ISSUE_LETTER[issue]}</span>
      {!decorative && <span className="sr-only">{label}</span>}
    </span>
  );
}
