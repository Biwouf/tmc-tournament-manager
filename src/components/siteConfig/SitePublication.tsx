import { useState } from 'react';
import { siteGaps } from '../../../shared/siteReadiness.mjs';
import type { Club } from '../../contexts/ClubContext';
import { useSitePublication } from '../../hooks/useSitePublication';
import type { ClubConfig } from '../../lib/clubConfig';

// SaaS S8 — état de publication du site d'un club self-serve, et la dépublication (la publication
// se fait aussi depuis la checklist du tableau de bord). `config` : la dernière enregistrée.
export default function SitePublication({ club, config }: { club: Club; config: ClubConfig }) {
  const { published, setSitePublished } = useSitePublication(club);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gaps = siteGaps(config);

  const change = async (value: boolean) => {
    const message = value
      ? 'Publier le site ? Il devient visible des moteurs de recherche.'
      : 'Dépublier le site ? Il reste en ligne, mais les moteurs de recherche ne le proposeront plus.';
    if (!window.confirm(message)) return;
    setBusy(true);
    setError(await setSitePublished(value));
    setBusy(false);
  };

  const button = 'min-h-11 shrink-0 rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';
  return (
    <section aria-labelledby="site-publication-title" className="flex flex-wrap items-center gap-4 rounded-2xl border bg-card/90 p-5 shadow-sm">
      <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${published ? 'bg-emerald-600' : 'bg-muted-foreground'}`} />
      <div className="min-w-0 flex-1" aria-live="polite">
        <h2 id="site-publication-title" className="m-0 text-base font-semibold">
          {published ? 'Site publié' : 'Site non publié — invisible des moteurs de recherche'}
        </h2>
        <p className="m-0 mt-0.5 text-sm text-muted-foreground">
          {published
            ? gaps.length
              ? `Publié, mais encore hors des moteurs de recherche tant qu’il manque : ${gaps.join(', ')}.`
              : config.settings.search_indexing
                ? 'Les moteurs de recherche peuvent le proposer.'
                : 'Publié, mais le référencement est désactivé dans « Affichage des sections ».'
            : gaps.length
              ? `Complétez-le avant de le publier. Il manque : ${gaps.join(', ')}.`
              : 'Le site est complet : vous pouvez l’ouvrir au public.'}
        </p>
        {error && <p role="alert" className="m-0 mt-1 text-sm text-destructive">{error}</p>}
      </div>
      {published
        ? <button type="button" disabled={busy} onClick={() => change(false)} className={`${button} border border-border bg-card text-card-foreground hover:bg-muted`}>Dépublier</button>
        : <button type="button" disabled={busy || gaps.length > 0} onClick={() => change(true)} className={`${button} bg-primary text-primary-foreground hover:brightness-95`}>Publier le site</button>}
    </section>
  );
}
