import { COMPO_COPY as T, playersLabel, previewNames } from '../../../../shared/teamCompoCopy.mjs';
import type { CardCompo } from '../../lib/teamLineup';

const LOCK = 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z';

/**
 * Ligne de compo sous « Équipe 1 · 9h » (brief compo-equipes §0 bis) : pastilles (3 au plus + « +N »)
 * et prénoms, « Vous jouez » si je joue, « Compo à venir » si vide, cadenas pour un visiteur.
 * Décorative : toute la carte est le lien, son `aria-label` porte l'information (`compoCardLabel`).
 */
export default function TeamCompoSummary({ compo }: { compo: CardCompo }) {
  if (compo === 'locked') return <span aria-hidden className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={LOCK} /></svg>
    {T.lockedCard}
  </span>;
  if (!compo || compo.count === 0) return <span aria-hidden className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
    <span className="h-[26px] w-[26px] rounded-full border border-dashed border-muted-foreground" />
    {T.compoToCome}
  </span>;
  const extra = compo.count - compo.preview.length;
  return <span aria-hidden className="mt-1.5 flex min-w-0 items-center gap-2 text-sm">
    <span className="flex shrink-0">
      {compo.preview.map((p, i) => <span key={i}
        className={`-ml-1 flex h-[26px] w-[26px] items-center justify-center rounded-full text-[9px] font-bold tracking-tight ring-2 ring-card first:ml-0 ${
          p.is_me ? 'bg-primary text-primary-foreground' : p.is_guest ? 'border border-dashed border-muted-foreground bg-card text-muted-foreground' : 'bg-muted text-foreground'}`}>{p.initials}</span>)}
      {extra > 0 && <span className="-ml-1 flex h-[26px] min-w-[26px] items-center justify-center rounded-full bg-muted px-1 text-[10px] font-bold text-muted-foreground ring-2 ring-card">+{extra}</span>}
    </span>
    {compo.is_me
      ? <><span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">{T.youPlay}</span><span className="whitespace-nowrap text-muted-foreground">{playersLabel(compo.count)}</span></>
      : <span className="truncate text-muted-foreground">{previewNames(compo.preview.map(p => p.prenom), compo.count)}</span>}
  </span>;
}
