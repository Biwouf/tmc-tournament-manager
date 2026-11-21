import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import TeamSheet from './TeamSheet';
import { COMPO_COPY as T, compoErrorMessage, compoNameKey, countHint, isStaleCompo, mixedCountLabel, splitGuestName } from '../../../../shared/teamCompoCopy.mjs';
import { fetchLineupCandidates, fullName, lineupEditable, outOfGenreLabel, saveLineup, type LineupCandidate, type LineupEntry, type LineupSex, type TeamLineup } from '../../lib/teamLineup';

type Filter = 'all' | 'male' | 'female';
type GuestDraft = { key: string; id?: string; prenom: string; nom: string; sex: LineupSex; checked: boolean };
type Person = { prenom: string; nom: string };

const nameKey = (p: Person) => compoNameKey(fullName(p));
const matches = (p: Person, search: string) => {
  const q = compoNameKey(search);
  return !q || nameKey(p).includes(q) || compoNameKey(`${p.nom} ${p.prenom}`).includes(q);
};
const initialFilter = (genre: string): Filter => genre === 'hommes' || genre === 'garcons' ? 'male' : genre === 'femmes' || genre === 'filles' ? 'female' : 'all';
const sexWord = (sex: LineupSex) => sex === 'male' ? 'homme' : sex === 'female' ? 'femme' : null;

/** Ligne cochable : toute la ligne est la cible (56 px), la case fait 26 px. */
function PlayerRow({ name, subtitle, rank, checked, onToggle }: {
  name: string; subtitle?: string | null; rank?: string | null; checked: boolean; onToggle: () => void;
}) {
  return <li><div role="checkbox" aria-checked={checked} tabIndex={0} onClick={onToggle}
    onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); onToggle(); } }}
    aria-label={subtitle ? `${name}, ${subtitle}` : name}
    className={`flex min-h-14 cursor-pointer items-center gap-3 px-1 py-2 active:opacity-70 ${checked ? 'bg-primary/5' : ''}`}>
    <span aria-hidden className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border-2 text-sm font-bold ${checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'}`}>{checked ? '✓' : ''}</span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[15px] font-medium">{name}</span>
      {subtitle && <span className="block text-sm text-muted-foreground">{subtitle}</span>}
    </span>
    {rank && <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-sm font-semibold tabular-nums">{rank}</span>}
  </div></li>;
}

export default function TeamLineupEditor({ clubId, rencontreId, lineup, onClose, onSaved, onReload }: {
  clubId: string; rencontreId: string; lineup: TeamLineup;
  onClose: () => void; onSaved: (saved: TeamLineup) => void; onReload: () => void;
}) {
  const candidatesQuery = useQuery({
    queryKey: ['team-compo-candidates', clubId, rencontreId], staleTime: 60_000,
    queryFn: () => fetchLineupCandidates(clubId, rencontreId),
  });
  const candidates = useMemo(() => candidatesQuery.data ?? [], [candidatesQuery.data]);
  const initialMembers = useMemo(() => lineup.players.filter(p => p.user_id).map(p => p.user_id!), [lineup]);
  // Les retenus restent en tête jusqu'à la fermeture : un joueur coché y remonte, un décoché y reste.
  const [pinned, setPinned] = useState(() => new Set(initialMembers));
  // Sexe attendu par la compétition (« all » en mixte) : filtre initial, invité prérempli, mention discrète.
  const expected = initialFilter(lineup.genre);
  const [selected, setSelected] = useState(() => new Set(initialMembers));
  const [guests, setGuests] = useState<GuestDraft[]>(() => lineup.players.filter(p => p.is_guest)
    .map(p => ({ key: p.id, id: p.id, prenom: p.prenom, nom: p.nom, sex: p.sex, checked: true })));
  const [filter, setFilter] = useState<Filter>(expected);
  const [search, setSearch] = useState('');
  const [guestForm, setGuestForm] = useState<{ prenom: string; nom: string; sex: LineupSex } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // La confirmation prend le focus ; à son retour, la recherche le reprend.
  const [wasConfirming, setWasConfirming] = useState(false);
  useEffect(() => {
    if (confirming) keepEditingRef.current?.focus();
    else if (wasConfirming) searchRef.current?.focus();
  }, [confirming, wasConfirming]);

  const byId = useMemo(() => new Map(candidates.map(c => [c.id, c])), [candidates]);
  // Un retenu qui a quitté le club n'est plus candidat : on garde son nom lu dans la compo.
  const person = (userId: string): (Person & Partial<LineupCandidate>) =>
    byId.get(userId) ?? lineup.players.find(p => p.user_id === userId) ?? { prenom: '', nom: '' };
  const leftClub = (userId: string) => !!candidatesQuery.data && !byId.has(userId);
  const checkedGuests = guests.filter(g => g.checked);
  const count = selected.size + checkedGuests.length;
  const dirty = selected.size !== initialMembers.length || initialMembers.some(id => !selected.has(id))
    || guests.some(g => !g.id || !g.checked);
  const hint = countHint(count, lineup.min_players, lineup.simples);
  const genreLabel = T.genreLabel(lineup.genre);
  /** Mention sur une personne cochée hors du genre de la rencontre (n'empêche rien). */
  const outOfGenre = (sex: LineupSex | undefined, checked: boolean) => checked ? outOfGenreLabel(sex, lineup.genre) : null;
  const mixed = lineup.genre === 'mixte'
    ? mixedCountLabel([...[...selected].map(id => person(id).sex ?? null), ...checkedGuests.map(g => g.sex)]) : null;

  const counts = { all: candidates.length, male: candidates.filter(c => c.sex === 'male').length, female: candidates.filter(c => c.sex === 'female').length };
  // Pendant une recherche, tout le club est parcouru : le filtre ne doit pas cacher un nom tapé,
  // et les puces montrent « Tous », le filtre réellement appliqué.
  const applied: Filter = search.trim() ? 'all' : filter;
  const club = candidates.filter(c => !pinned.has(c.id) && (search.trim() ? matches(c, search) : filter === 'all' || c.sex === filter));
  const retainedMembers = [...pinned].filter(id => matches(person(id), search));
  const retainedGuests = guests.filter(g => matches(g, search));
  const typed = search.trim();
  const exactMember = typed.length >= 2 && candidates.some(c => nameKey(c) === compoNameKey(typed) || compoNameKey(`${c.nom} ${c.prenom}`) === compoNameKey(typed));
  const partialMembers = candidates.filter(c => matches(c, typed));
  // Un invité déjà dans la liste (coché ou non) apparaît dans les retenus : pas de second ajout.
  const exactGuest = guests.some(g => compoNameKey(fullName(g)) === compoNameKey(typed));
  const canAddGuest = typed.length >= 2 && !exactMember && !exactGuest;

  const toggleMember = (id: string) => {
    setError(null);
    if (!selected.has(id) && !pinned.has(id)) setPinned(prev => new Set(prev).add(id));
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const toggleGuest = (key: string) => { setError(null); setGuests(prev => prev.map(g => g.key === key ? { ...g, checked: !g.checked } : g)); };
  const guestSexDefault: LineupSex = expected === 'all' ? null : expected;
  const openGuestForm = () => setGuestForm({ ...splitGuestName(typed), sex: guestSexDefault });
  // La carte n'apparaît que pour un nom absent des invités (`exactGuest`) : pas de doublon possible ici.
  const addGuest = (form: { prenom: string; nom: string; sex: LineupSex }) => {
    if (!form.prenom) return;
    setGuests(prev => [...prev, { key: `new-${prev.length}-${compoNameKey(fullName(form))}`, ...form, checked: true }]);
    setGuestForm(null);
    setSearch('');
    setError(null);
  };
  const close = () => { if (saving) return; if (dirty) { setConfirming(true); setWasConfirming(true); } else onClose(); };
  const save = async () => {
    if (saving) return;
    // Un retenu sorti du club serait refusé par la base : on le nomme avant d'envoyer.
    const gone = [...selected].filter(leftClub).map(id => fullName(person(id)));
    if (gone.length) { setError({ message: T.notMemberError(gone), stale: false }); return; }
    setSaving(true);
    setError(null);
    const entries: LineupEntry[] = [...[...selected].map(user_id => ({ user_id })),
      ...checkedGuests.map(g => g.id ? { id: g.id } : { prenom: g.prenom, nom: g.nom, sex: g.sex })];
    try {
      onSaved(await saveLineup(clubId, rencontreId, entries, lineup.version));
    } catch (e) {
      setError({ message: compoErrorMessage(e, { offline: typeof navigator !== 'undefined' && navigator.onLine === false }), stale: isStaleCompo(e) });
    } finally {
      setSaving(false);
    }
  };

  const memberSubtitle = (p: Person & Partial<LineupCandidate>, checked: boolean) =>
    [p.is_captain ? T.captain : p.classement ? null : T.rankUnknown, outOfGenre(p.sex, checked)]
      .filter(Boolean).join(' · ') || null;
  const retainedRows = retainedMembers.length + retainedGuests.length;
  const guestSubtitle = (g: GuestDraft) => [T.guest, outOfGenre(g.sex, g.checked) ?? sexWord(g.sex)].filter(Boolean).join(' · ');

  if (!lineupEditable(lineup)) return <TeamSheet title={T.sheetTitle} onClose={onClose}>
    <p role="alert" className="text-sm text-red-700">{T.cannotEdit}</p>
  </TeamSheet>;

  return <TeamSheet title={T.sheetTitle} onClose={close} busy={saving}>
    {confirming ? <div className="space-y-3" role="alertdialog" aria-label={T.discardTitle}>
      <p className="text-[15px] font-semibold">{T.discardTitle}</p>
      <button ref={keepEditingRef} onClick={() => setConfirming(false)} className="min-h-12 w-full rounded-xl bg-primary p-3 font-semibold text-primary-foreground">{T.keepEditing}</button>
      <button onClick={onClose} className="min-h-12 w-full rounded-xl border border-border p-3 font-semibold">{T.discard}</button>
    </div> : <>
      {lineup.simples != null && lineup.doubles != null && <p className="-mt-3 mb-3 text-sm text-muted-foreground">{T.sheetSubtitle(lineup.simples, lineup.doubles)}{genreLabel ? ` · ${genreLabel}` : ''}</p>}
      <input ref={searchRef} type="search" value={search} onChange={event => { setSearch(event.target.value); setGuestForm(null); }}
        placeholder={T.search} aria-label={T.search}
        className="min-h-12 w-full rounded-xl border border-border bg-muted px-4 text-base" /* 16 px : pas de zoom iOS au focus */ />
      {candidatesQuery.data && <div role="radiogroup" aria-label={T.filterLabel} className="mt-3 flex flex-wrap gap-2">
        {/* Choisir un filtre pendant une recherche efface la recherche : la puce dit alors vrai. */}
        {(['all', 'male', 'female'] as const).map(key => <button key={key} role="radio" aria-checked={applied === key} onClick={() => { setFilter(key); setSearch(''); setGuestForm(null); }}
          className={`min-h-11 rounded-full border px-4 text-[15px] font-semibold ${applied === key ? 'border-foreground bg-foreground text-background' : 'border-border bg-card'}`}>
          {T.filters[key]} <span className="font-medium opacity-70">{counts[key]}</span>
        </button>)}
      </div>}

      {candidatesQuery.isError && <div role="alert" className="mt-4 flex items-center justify-between gap-3 text-sm text-red-700">
        <span>{T.candidatesError}</span>
        <button className="min-h-11 shrink-0 px-2 font-semibold underline" onClick={() => void candidatesQuery.refetch()}>{T.retry}</button>
      </div>}
      {candidatesQuery.isPending && <div className="mt-4 space-y-2" role="status" aria-label="Chargement des membres…"><div className="sk h-14 rounded-xl" /><div className="sk h-14 rounded-xl" /></div>}

      {retainedRows > 0 && <>
        <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{T.retained(count)}</h3>
        <ul className="mt-1 divide-y divide-border">
          {retainedMembers.map(id => { const p = person(id); return <PlayerRow key={id} name={fullName(p)} subtitle={leftClub(id) ? T.notMember : memberSubtitle(p, selected.has(id))} rank={p.classement} checked={selected.has(id)} onToggle={() => toggleMember(id)} />; })}
          {retainedGuests.map(g => <PlayerRow key={g.key} name={fullName(g)} subtitle={guestSubtitle(g)} checked={g.checked} onToggle={() => toggleGuest(g.key)} />)}
        </ul>
      </>}

      {candidatesQuery.data && <>
        {club.length > 0 && <>
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{T.clubGroup(typed ? 'all' : filter)}</h3>
          <ul className="mt-1 divide-y divide-border">
            {club.map(c => <PlayerRow key={c.id} name={fullName(c)} subtitle={memberSubtitle(c, selected.has(c.id))} rank={c.classement} checked={selected.has(c.id)} onToggle={() => toggleMember(c.id)} />)}
          </ul>
        </>}
        {canAddGuest && partialMembers.length === 0 && <p className="mt-4 text-sm text-muted-foreground">{T.noMember(typed)}</p>}
        {canAddGuest && !guestForm && partialMembers.length > 0 && <button onClick={openGuestForm}
          className="mt-2 min-h-12 w-full rounded-xl border border-dashed border-border px-4 text-left text-[15px] font-semibold">{T.addGuestQuoted(typed)}</button>}
        {canAddGuest && (guestForm || partialMembers.length === 0) && (() => {
          const form = guestForm ?? { ...splitGuestName(typed), sex: guestSexDefault };
          return <div className="mt-3 rounded-2xl border border-primary p-4">
            <p className="text-[17px] font-bold">{T.addGuest(fullName(form))}</p>
            <p className="mt-1 text-sm text-muted-foreground">{T.guestNote}</p>
            <p className="mt-3 text-sm font-semibold" id="guest-sex">{T.guestSex}</p>
            <div role="radiogroup" aria-labelledby="guest-sex" className="mt-2 grid grid-cols-3 gap-2">
              {T.sexOptions.map(([value, label]) => <button key={label} role="radio" aria-checked={(form.sex ?? '') === value}
                onClick={() => setGuestForm({ ...form, sex: (value || null) as LineupSex })}
                className={`min-h-11 whitespace-nowrap rounded-xl border px-1 text-sm font-semibold ${(form.sex ?? '') === value ? 'border-2 border-foreground' : 'border-border'}`}>{label}</button>)}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => { setGuestForm(null); setSearch(''); }} className="min-h-12 rounded-xl border border-border font-semibold">{T.cancel}</button>
              <button onClick={() => addGuest(form)} className="min-h-12 rounded-xl bg-primary font-semibold text-primary-foreground">{T.add}</button>
            </div>
          </div>;
        })()}
      </>}

      <div className="sticky bottom-0 -mx-5 -mb-5 mt-5 border-t border-border bg-card px-5 pb-5 pt-3">
        {!candidatesQuery.isError && <p role="status" className={`text-center text-sm ${hint.short ? 'font-semibold text-orange-700' : 'text-muted-foreground'}`}>{mixed ?? hint.text}{mixed && hint.short ? ` · ${hint.text}` : ''}</p>}
        {error && <div role="alert" className="mt-2 text-sm text-red-700">
          {error.message}
          {error.stale && <button onClick={onReload} className="ml-2 min-h-11 font-semibold underline">{T.reload}</button>}
        </div>}
        <button onClick={() => void save()} aria-busy={saving} className="mt-3 min-h-12 w-full rounded-xl bg-primary p-3 font-semibold text-primary-foreground">{saving ? T.saving : T.save}</button>
      </div>
    </>}
  </TeamSheet>;
}
