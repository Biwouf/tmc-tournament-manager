// SaaS S8b — « Remplir depuis Ten'Up » en tête de `/admin/site` : proposition lue en tâche de
// fond (bandeau), ou lien du club collé ; relecture par panneau, case par valeur, puis
// enregistrement par le chemin de `SiteConfigPanel` (`saveClubConfigGroup`). Rien n'est écrit sans
// « Enregistrer ». Logique pure : `lib/tenupSiteImport.ts` ; appels : `lib/tenupSiteClient.ts`.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { siteGaps } from '../../../shared/siteReadiness.mjs';
import { normalizeTenupClubProfileUrl } from '../../../shared/tenupSite.mjs';
import type { ClubConfig } from '../../lib/clubConfig';
import { saveClubConfigGroup } from '../../lib/clubConfigWrite';
import { deleteConfigImage } from '../../lib/configImages';
import { extraPanelPath, missingSiteExtras } from '../../lib/siteExtras';
import { supabase } from '../../lib/supabase';
import { consumeTenupSite, loadTenupSite, readTenupSite, type TenupSiteState } from '../../lib/tenupSiteClient';
import {
  REVIEW_CARDS, applyReview, buildReview, offerSummary, unusedProposalImages,
  type ReviewItem, type TenupSiteProposal,
} from '../../lib/tenupSiteImport';

type Phase = 'loading' | 'idle' | 'form' | 'reading' | 'review' | 'saving' | 'saved';
const PAGES: { key: keyof TenupSiteProposal['pages']; label: string }[] = [
  { key: 'club', label: 'Le club' }, { key: 'equipe', label: 'Équipe' }, { key: 'offres', label: 'Offres' }, { key: 'installation', label: 'Installations' },
];
const button = 'min-h-11 rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';
const primary = `${button} bg-primary text-primary-foreground hover:brightness-95`;
const secondary = `${button} border border-border bg-card text-card-foreground hover:bg-muted`;
const parisDate = (iso: string) => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function TenupSiteImport({ clubId, config, onSaved }: {
  clubId: string;
  /** La dernière config enregistrée (relue après chaque enregistrement). */
  config: ClubConfig;
  /** Après l'enregistrement : relire la config et remonter les panneaux. */
  onSaved: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [state, setState] = useState<TenupSiteState>({ available: false });
  const [proposal, setProposal] = useState<TenupSiteProposal | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [filled, setFilled] = useState(0);

  const load = useCallback(() => loadTenupSite(supabase, clubId).then(
    (result) => {
      setState(result.state);
      setProposal(result.proposal);
      setPhase((p) => (p === 'loading' || p === 'idle' ? 'idle' : p));
    },
    () => { setState({ available: false }); setPhase('idle'); },
  ), [clubId]);
  useEffect(() => { void load(); }, [load]);

  // Lecture en tâche de fond en cours (import des équipes tout juste fini) : relire l'état.
  useEffect(() => {
    if (phase !== 'idle' || !state.running || proposal) return;
    const timer = window.setTimeout(() => void load(), 8_000);
    return () => window.clearTimeout(timer);
  }, [phase, state.running, proposal, load]);

  if (!state.available || phase === 'loading') return null;

  const openReview = (p: TenupSiteProposal) => {
    setProposal(p);
    setItems(buildReview(p, config));
    setSaveErrors([]);
    setPhase('review');
  };

  const read = async () => {
    try { normalizeTenupClubProfileUrl(url); } catch (err) { setError((err as Error).message); return; }
    setError(null);
    setPhase('reading');
    try {
      // Pas de relecture de l'état ici : elle remplacerait la proposition en cours de relecture.
      openReview(await readTenupSite(supabase, clubId, url));
    } catch (err) {
      setError((err as Error).message);
      setPhase('form');
      void load();
    }
  };

  const update = (id: string, patch: Partial<ReviewItem>) => setItems((list) => list.map((item) => {
    if (item.id !== id) return item;
    const next = { ...item, ...patch };
    if (patch.entry && item.list) next.next = offerSummary(item.list, patch.entry);
    return next;
  }));

  const save = async () => {
    if (!proposal) return;
    setPhase('saving');
    const write = applyReview(config, items);
    const errors: string[] = [];
    for (const { group, value } of write.groups) {
      const result = await saveClubConfigGroup(clubId, group, value);
      if (!result.success) errors.push(...result.errors.map((e) => `${group.label} : ${e}`));
    }
    if (errors.length) { setSaveErrors(errors); setPhase('review'); onSaved(); return; }
    for (const image of [...write.replaced, ...unusedProposalImages(proposal, items)]) await deleteConfigImage(image);
    await consumeTenupSite(supabase, clubId).catch(() => {});
    setFilled(write.filled);
    setProposal(null);
    setPhase('saved');
    onSaved();
    void load();
  };

  const nextRead = state.next_read_at && new Date(state.next_read_at) > new Date() ? state.next_read_at : null;
  const rereadLink = (
    nextRead
      ? <p className="m-0 text-xs text-muted-foreground">Nouvelle lecture Ten’Up possible le {parisDate(nextRead)}.</p>
      : <button type="button" className="text-sm font-medium text-primary underline-offset-2 hover:underline" onClick={() => { setError(null); setPhase('form'); }}>
          Relire depuis Ten’Up
        </button>
  );

  return (
    <section aria-labelledby="tenup-site-title" className="rounded-2xl border bg-card/90 p-5 shadow-sm">
      <div aria-live="polite">
        {phase === 'idle' && proposal && (
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <h2 id="tenup-site-title" className="m-0 text-base font-semibold">Votre site a été prérempli depuis Ten’Up — relisez et enregistrez</h2>
              <p className="m-0 mt-0.5 text-sm text-muted-foreground">Adresse, contact, réseaux, images, bureau, terrains et tarifs : rien n’est publié avant votre relecture.</p>
            </div>
            <button type="button" className={primary} onClick={() => openReview(proposal)}>Relire</button>
          </div>
        )}
        {phase === 'idle' && !proposal && (
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <h2 id="tenup-site-title" className="m-0 text-base font-semibold">Remplir depuis Ten’Up</h2>
              <p className="m-0 mt-0.5 text-sm text-muted-foreground">
                {state.running ? 'Lecture de votre club sur Ten’Up en cours…' : 'Adresse, contact, réseaux, logo, bureau, terrains et tarifs repris de la page de votre club, à relire avant d’enregistrer.'}
              </p>
            </div>
            {!state.running && (nextRead
              ? rereadLink
              : <button type="button" className={primary} onClick={() => { setError(null); setPhase('form'); }}>Remplir depuis Ten’Up</button>)}
          </div>
        )}
        {(phase === 'form' || phase === 'reading') && (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void read(); }}>
            <h2 id="tenup-site-title" className="m-0 text-base font-semibold">Remplir depuis Ten’Up</h2>
            <label className="flex flex-col gap-1 text-sm font-medium" htmlFor="tenup-site-url">
              Lien de votre club sur Ten’Up
              <input id="tenup-site-url" type="url" inputMode="url" required value={url} disabled={phase === 'reading'}
                placeholder="https://tenup.fft.fr/club/…" aria-describedby="tenup-site-help" aria-invalid={Boolean(error)}
                onChange={(e) => { setUrl(e.target.value); setError(null); }}
                className="min-h-11 rounded-lg border border-border bg-background px-3 font-normal" />
            </label>
            <details id="tenup-site-help" className="text-sm text-muted-foreground">
              <summary className="cursor-pointer">Où trouver ce lien ?</summary>
              Sur tenup.fft.fr, cherchez votre club puis copiez l’adresse de sa page (n’importe quel onglet : « Le club », « Équipe & contact »…).
            </details>
            {error && <p role="alert" className="m-0 text-sm text-destructive">{error}</p>}
            {phase === 'reading' && (
              <ul className="m-0 list-none p-0 text-sm" role="status">
                {PAGES.map((p) => <li key={p.key}>⏳ {p.label} — lecture en cours</li>)}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={primary} disabled={phase === 'reading' || !url.trim()}>{phase === 'reading' ? 'Lecture…' : 'Lire la page du club'}</button>
              <button type="button" className={secondary} disabled={phase === 'reading'} onClick={() => setPhase('idle')}>Annuler</button>
            </div>
          </form>
        )}
        {(phase === 'review' || phase === 'saving') && proposal && (
          <Review proposal={proposal} items={items} saving={phase === 'saving'} errors={saveErrors}
            onToggle={(id, checked) => update(id, { checked })} onChange={update}
            onSave={() => void save()} onLater={() => setPhase('idle')} />
        )}
        {phase === 'saved' && (
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <h2 id="tenup-site-title" className="m-0 text-base font-semibold">{filled} champ{filled > 1 ? 's' : ''} rempli{filled > 1 ? 's' : ''} depuis Ten’Up</h2>
              <p className="m-0 mt-0.5 text-sm text-muted-foreground">
                {siteGaps(config).length
                  ? `Il manque encore : ${siteGaps(config).join(', ')}. Complétez les panneaux ci-dessous.`
                  : 'Votre site est complet : vous pouvez le publier avec « Publier le site ».'}
              </p>
              {/* S8b-bis : ce que Ten'Up ne donne pas, à ajouter à la main (facultatif). */}
              {missingSiteExtras(config).length > 0 && (
                <div className="mt-3">
                  <p className="m-0 text-sm font-medium">À compléter ensuite, Ten’Up ne le donne pas :</p>
                  <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0 text-sm">
                    {missingSiteExtras(config).map((extra) => (
                      <li key={extra.id}>
                        <Link to={extraPanelPath(extra)} className="font-medium text-primary underline-offset-2 hover:underline">{extra.title}</Link>
                        <span className="text-muted-foreground"> — {extra.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {!siteGaps(config).length && (
              <button type="button" className={primary} onClick={() => document.getElementById('site-publication-title')?.scrollIntoView({ block: 'center' })}>Publier le site</button>
            )}
            {rereadLink}
          </div>
        )}
      </div>
      {phase === 'idle' && proposal && <div className="mt-2">{rereadLink}</div>}
    </section>
  );
}

function Review({ proposal, items, saving, errors, onToggle, onChange, onSave, onLater }: {
  proposal: TenupSiteProposal;
  items: ReviewItem[];
  saving: boolean;
  errors: string[];
  onToggle: (id: string, checked: boolean) => void;
  onChange: (id: string, patch: Partial<ReviewItem>) => void;
  onSave: () => void;
  onLater: () => void;
}) {
  const failed = PAGES.filter((p) => proposal.pages[p.key] === 'failed');
  const count = items.filter((i) => i.checked && !i.disabled).length;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 id="tenup-site-title" className="m-0 text-base font-semibold">Relisez ce que Ten’Up dit de votre club</h2>
        <p className="m-0 mt-0.5 text-sm text-muted-foreground">Décochez ce que vous ne voulez pas. Les lignes « à vérifier » sont décochées. Les listes ne sont jamais remplacées : les lignes cochées s’y ajoutent.</p>
        {failed.length > 0 && <p className="m-0 mt-1 text-sm text-amber-700 dark:text-amber-400">Pages non lues : {failed.map((p) => p.label).join(', ')}. Le reste est utilisable.</p>}
      </div>
      {items.length === 0 && <p className="m-0 text-sm text-muted-foreground">Rien de nouveau sur Ten’Up : votre site contient déjà ces informations.</p>}
      {REVIEW_CARDS.map(({ group, title }) => {
        const mine = items.filter((i) => i.group === group);
        if (!mine.length) return null;
        return (
          <fieldset key={group} className="m-0 rounded-xl border border-border p-4">
            <legend className="px-1 text-sm font-semibold">{title}</legend>
            {group === 'club' && mine.some((i) => i.list === 'board' || i.field === 'president_name') && (
              <p className="m-0 mb-2 text-xs text-muted-foreground">Ces noms seront publiés sur votre site.</p>
            )}
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {mine.map((item) => <ReviewRow key={item.id} item={item} disabled={saving} onToggle={onToggle} onChange={onChange} />)}
            </ul>
          </fieldset>
        );
      })}
      {errors.length > 0 && (
        <div role="alert" className="text-sm text-destructive">
          <p className="m-0 font-medium">Certains panneaux n’ont pas été enregistrés :</p>
          <ul className="m-0 pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      <div className="sticky bottom-0 flex flex-wrap gap-2 bg-card/95 py-2">
        <button type="button" className={primary} disabled={saving || count === 0} onClick={onSave}>{saving ? 'Enregistrement…' : `Enregistrer (${count})`}</button>
        <button type="button" className={secondary} disabled={saving} onClick={onLater}>Plus tard</button>
      </div>
    </div>
  );
}

function ReviewRow({ item, disabled, onToggle, onChange }: {
  item: ReviewItem;
  disabled: boolean;
  onToggle: (id: string, checked: boolean) => void;
  onChange: (id: string, patch: Partial<ReviewItem>) => void;
}) {
  const id = `tenup-review-${item.id.replace(/\W/g, '-')}`;
  const value = (v: string) => (item.image
    ? v ? <img src={v} alt="" className="inline-block h-12 max-w-[8rem] rounded border border-border bg-muted object-contain align-middle" /> : <span>—</span>
    : <span className="[overflow-wrap:anywhere]">{v || '—'}</span>);
  return (
    <li className="flex gap-3">
      <input id={id} type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={item.checked && !item.disabled}
        disabled={disabled || item.disabled} onChange={(e) => onToggle(item.id, e.target.checked)}
        aria-describedby={item.warning ? `${id}-warning` : undefined} />
      <div className="min-w-0 flex-1 text-sm">
        <label htmlFor={id} className="font-medium">{item.label}</label>
        {item.warning && <span id={`${id}-warning`} className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">à vérifier : {item.warning}</span>}
        {item.current
          ? <p className="m-0 mt-1 text-muted-foreground [overflow-wrap:anywhere]">actuel : {value(item.current)} → Ten’Up : {value(item.next)}</p>
          : item.editable === 'text'
            ? <input aria-label={item.label} value={item.next} disabled={disabled} onChange={(e) => onChange(item.id, { next: e.target.value })}
                className="mt-1 block min-h-11 w-full rounded-lg border border-border bg-background px-3" />
            : item.editable !== 'offer' && <p className="m-0 mt-1">{value(item.next)}</p>}
        {item.editable === 'offer' && item.entry && item.list && (
          <div className="mt-1 flex flex-wrap gap-2">
            <input aria-label={`Nom — ${item.label}`} disabled={disabled} className="min-h-11 min-w-0 flex-[3_1_12rem] rounded-lg border border-border bg-background px-3"
              value={item.list === 'other_fees' ? item.entry.label : item.entry.name}
              onChange={(e) => onChange(item.id, { entry: { ...item.entry!, [item.list === 'other_fees' ? 'label' : 'name']: e.target.value } })} />
            <input aria-label={`Prix — ${item.label}`} disabled={disabled} inputMode={item.list === 'other_fees' ? 'text' : 'decimal'}
              className="min-h-11 w-28 flex-[1_1_6rem] rounded-lg border border-border bg-background px-3" value={item.entry.price}
              onChange={(e) => onChange(item.id, { entry: { ...item.entry!, price: e.target.value } })} />
          </div>
        )}
        {item.note && <p className="m-0 mt-1 text-xs text-muted-foreground">{item.note}</p>}
      </div>
    </li>
  );
}
