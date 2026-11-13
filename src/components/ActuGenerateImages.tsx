import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { useClub } from '../contexts/ClubContext';
import { useClubConfig } from '../hooks/useClubConfig';
import { drawPosterPartners, newPartnerSeed } from '../lib/posterPartners';
import type { RencontreEntry } from './teamMatches/gridTypes';
import { competitionLabel, etapeLabel } from './teamMatches/teamMatchLabels';
import { finalResult } from './teamMatches/poster/resultPoster';
import { renderResultPoster, type ResultPosterInput } from './teamMatches/poster/renderResultPoster';
import type { TeamMatchLine } from '../types';

/** Une image retenue : visuel « Esprit d'équipe » (PNG en data URL) ou photo de rencontre. */
export type ActuImagePick = { kind: 'visuel' | 'photo'; src: string; rencontreId: string; adversaire: string };
/** Images cochées « À la une » (galerie de l'actu) et « Dans le texte » (après le paragraphe de leur rencontre). */
export type ActuImagePicks = {
  une: ActuImagePick[];
  texte: ActuImagePick[];
  /** Faux tant qu'un visuel coché n'est pas rendu. */
  ready: boolean;
};

type Placement = { une: boolean; texte: boolean };
type Item = { key: string; kind: 'visuel' | 'photo'; src: string | null; failed?: boolean; entry: RencontreEntry };
/** Par défaut : visuels dans le texte, photos à la une. */
const DEFAULT_PLACEMENT: Record<Item['kind'], Placement> = { visuel: { une: false, texte: true }, photo: { une: true, texte: false } };

/**
 * Images de l'actu générée (`ActuGeneratePage`) : un visuel « Esprit d'équipe » par rencontre
 * terminée qui a des photos (même rendu que `/medias`), puis les photos des rencontres. Chaque
 * image a deux cases indépendantes, « À la une » (galerie de l'actu) et « Dans le texte » :
 * les deux, l'une, ou aucune (image écartée).
 */
export default function ActuGenerateImages({ chosen, lines, onChange }: {
  chosen: RencontreEntry[];
  lines: Record<string, TeamMatchLine[]>;
  onChange: (images: ActuImagePicks) => void;
}) {
  const { config, loading } = useClubConfig();
  const { club } = useClub();
  const [partnerSeed] = useState(newPartnerSeed);
  const partners = useMemo(() => drawPosterPartners(config.partners.filter(p => p.logo || p.name), partnerSeed), [config.partners, partnerSeed]);
  const [visualPhoto, setVisualPhoto] = useState<Record<string, string>>({});
  const [rendered, setRendered] = useState<Record<string, string | null>>({});
  const [placements, setPlacements] = useState<Record<string, Placement>>({});

  const visualEntries = chosen.filter(e => e.rencontre.photo_urls.length > 0 && lines[e.rencontre.id] &&
    finalResult(e.rencontre, lines[e.rencontre.id], e.competition.format));
  const photoOf = (e: RencontreEntry) => visualPhoto[e.rencontre.id] ?? e.rencontre.photo_urls[0];
  const renderKey = (e: RencontreEntry) => `${e.rencontre.id}|${photoOf(e)}`;
  const items: Item[] = [
    ...visualEntries.map(e => {
      const value = rendered[renderKey(e)];
      return { key: `visuel:${e.rencontre.id}`, kind: 'visuel' as const, src: value ?? null, failed: value === null, entry: e };
    }),
    ...chosen.flatMap(e => e.rencontre.photo_urls.map(url => ({ key: url, kind: 'photo' as const, src: url, entry: e }))),
  ];
  const placementOf = (item: Item): Placement => item.failed ? { une: false, texte: false } : placements[item.key] ?? DEFAULT_PLACEMENT[item.kind];
  const pick = (item: Item): ActuImagePick[] => item.src
    ? [{ kind: item.kind, src: item.src, rencontreId: item.entry.rencontre.id, adversaire: item.entry.rencontre.club_adverse }] : [];
  const une = items.filter(item => placementOf(item).une);
  const texte = items.filter(item => placementOf(item).texte);
  const ready = [...une, ...texte].every(item => item.src !== null);
  // Change dès qu'une case change, ou qu'un visuel change de photo ou finit son rendu.
  const describe = (item: Item) => item.kind === 'visuel' ? `${item.key}:${photoOf(item.entry)}:${item.src ? 1 : 0}` : item.key;
  const signature = `${une.map(describe).join('|')}#${texte.map(describe).join('|')}`;
  const report = useEffectEvent(() => onChange({ une: une.flatMap(pick), texte: texte.flatMap(pick), ready }));
  useEffect(() => { report(); }, [signature]);

  if (items.length === 0) return null;
  const toggle = (item: Item, field: keyof Placement) =>
    setPlacements(previous => {
      const current = previous[item.key] ?? DEFAULT_PLACEMENT[item.kind];
      return { ...previous, [item.key]: { ...current, [field]: !current[field] } };
    });
  return (
    <fieldset className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <legend className="sr-only">Images de l’actu</legend>
      <p className="font-semibold">Images de l’actu</p>
      <p className="mb-3 text-xs text-muted-foreground">
        « À la une » : galerie en tête de l’actu. « Dans le texte » : juste après le paragraphe qui raconte la rencontre. Les deux, l’une ou aucune (image retirée). Rien de tout cela n’est envoyé à l’IA ; les légendes s’écrivent ensuite dans l’actu.
      </p>
      {!loading && visualEntries.map(e => (
        <PosterRender key={renderKey(e)} input={{
          rencontre: e.rencontre, lines: lines[e.rencontre.id], config, partners, model: 'photo', photo: photoOf(e), crop: { x: 50, y: 50, zoom: 1 },
          result: finalResult(e.rencontre, lines[e.rencontre.id], e.competition.format)!,
          clubName: config.brand.name || club?.name || 'Notre club',
          heading: competitionLabel(e.competition), stage: `Équipe ${e.equipe.numero} · ${etapeLabel(e.etape)}`,
        }} onDone={url => setRendered(previous => ({ ...previous, [renderKey(e)]: url }))} />
      ))}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map(item => {
          const placement = placementOf(item);
          const isKept = placement.une || placement.texte;
          return (
            <div key={item.key} className={`space-y-2 rounded-xl border p-2 ${isKept ? 'border-primary ring-1 ring-primary' : 'border-border'}`}>
              <div className="relative">
                {item.src
                  ? <img src={item.src} alt="" className={`aspect-[4/5] w-full rounded-lg object-cover ${isKept ? '' : 'opacity-30'}`} />
                  : <div className="flex aspect-[4/5] w-full items-center justify-center rounded-lg bg-muted p-2 text-center text-xs text-muted-foreground">
                      {item.failed ? 'Visuel indisponible' : 'Préparation du visuel…'}
                    </div>}
                {item.kind === 'visuel' && <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">Esprit d’équipe</span>}
              </div>
              <p className="truncate text-xs text-muted-foreground">{item.entry.rencontre.club_adverse}</p>
              {item.kind === 'visuel' && item.entry.rencontre.photo_urls.length > 1 && (
                <select aria-label="Photo du visuel" className="w-full rounded-lg border border-border bg-background p-1 text-xs" value={photoOf(item.entry)}
                  onChange={event => setVisualPhoto(previous => ({ ...previous, [item.entry.rencontre.id]: event.target.value }))}>
                  {item.entry.rencontre.photo_urls.map((url, index) => <option key={url} value={url}>Photo {index + 1}</option>)}
                </select>
              )}
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
                <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-primary" disabled={item.failed} checked={placement.une} onChange={() => toggle(item, 'une')} />À la une</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-primary" disabled={item.failed} checked={placement.texte} onChange={() => toggle(item, 'texte')} />Dans le texte</label>
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Rend un visuel « Esprit d'équipe » ; `null` si une image ne se charge pas. */
function PosterRender({ input, onDone }: { input: ResultPosterInput; onDone: (url: string | null) => void }) {
  const done = useEffectEvent(onDone);
  useEffect(() => {
    let cancelled = false;
    renderResultPoster(input).then(url => { if (!cancelled) done(url); }).catch(() => { if (!cancelled) done(null); });
    return () => { cancelled = true; };
    // Rendu une seule fois par rencontre et par photo (la clé du composant change avec elles).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
