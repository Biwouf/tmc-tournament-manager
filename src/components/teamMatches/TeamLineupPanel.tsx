import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  COMPO_COPY as T, compoErrorMessage, compoNameKey, countHint, isStaleCompo, mixedCountLabel, playersLabel, splitGuestName, updatedLine,
} from '../../../shared/teamCompoCopy.mjs';
import {
  expectedSex, fetchLineup, fetchLineupCandidates, fullName, lineupEditable, saveLineup,
  type LineupCandidate, type LineupEntry, type LineupSex, type TeamLineup,
} from '../../lib/teamLineup';

type Filter = 'all' | 'male' | 'female';
type GuestDraft = { key: string; id?: string; prenom: string; nom: string; sex: LineupSex };
type Person = { prenom: string; nom: string };

const SEX_SHORT = { male: 'H', female: 'F' } as const;
const sexWord = (sex: LineupSex) => sex === 'male' ? 'homme' : sex === 'female' ? 'femme' : null;
const matches = (p: Person, search: string) => {
  const q = compoNameKey(search);
  return !q || compoNameKey(fullName(p)).includes(q) || compoNameKey(`${p.nom} ${p.prenom}`).includes(q);
};
const initials = (p: Person) => `${p.prenom.trim()[0] ?? ''}${p.nom.trim()[0] ?? ''}`.toUpperCase();

/**
 * Section « Compo » de la fiche rencontre du BO (brief compo-equipes §4.2, maquette bo-01) : membres du
 * club à cocher à gauche, compo à droite, joueur sans compte, puis un seul enregistrement. Mêmes RPC,
 * mêmes textes (`shared/teamCompoCopy`) et mêmes règles que la feuille « Choisir les joueurs » de l'app.
 */
export default function TeamLineupPanel({ clubId, rencontreId }: { clubId: string; rencontreId: string }) {
  const [lineup, setLineup] = useState<TeamLineup | null>(null);
  const [candidates, setCandidates] = useState<LineupCandidate[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [candidatesError, setCandidatesError] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [guests, setGuests] = useState<GuestDraft[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestSex, setGuestSex] = useState<LineupSex>(null);
  const [guestError, setGuestError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null);
  const [saved, setSaved] = useState(false);

  // Brouillon local = compo enregistrée ; « Annuler les changements » y revient.
  const reset = useCallback((fresh: TeamLineup) => {
    setLineup(fresh);
    setSelected(fresh.players.filter(p => p.user_id).map(p => p.user_id!));
    setGuests(fresh.players.filter(p => p.is_guest).map(p => ({ key: p.id, id: p.id, prenom: p.prenom, nom: p.nom, sex: p.sex })));
    setFilter(expectedSex(fresh.genre) ?? 'all');
    setGuestSex(expectedSex(fresh.genre));
    setError(null);
  }, []);
  const load = useCallback(async () => {
    setLoadError(false);
    let fresh: TeamLineup;
    try { fresh = await fetchLineup(clubId, rencontreId); } catch { setLoadError(true); return; }
    reset(fresh);
    if (!fresh.can_edit) return;
    setCandidatesError(false);
    try { setCandidates(await fetchLineupCandidates(clubId, rencontreId)); } catch { setCandidatesError(true); }
  }, [clubId, rencontreId, reset]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 3000);
    return () => clearTimeout(timer);
  }, [saved]);

  const byId = useMemo(() => new Map((candidates ?? []).map(c => [c.id, c])), [candidates]);
  if (loadError) return <section className="rounded-2xl border bg-card/90 p-6 shadow-sm">
    <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{T.title}</h2>
    <p role="alert" className="mt-2 text-sm text-red-700">{T.loadError} <button className="min-h-11 px-2 font-semibold underline" onClick={() => void load()}>{T.retry}</button></p>
  </section>;
  if (!lineup) return <section className="h-40 animate-pulse rounded-2xl border bg-card/90" aria-label="Chargement de la compo…" />;

  const genreLabel = T.genreLabel(lineup.genre);
  const expected = expectedSex(lineup.genre);
  const person = (id: string): Person & Partial<LineupCandidate> =>
    byId.get(id) ?? lineup.players.find(p => p.user_id === id) ?? { prenom: '', nom: '' };
  const leftClub = (id: string) => !!candidates && !byId.has(id);
  const initialMembers = lineup.players.filter(p => p.user_id).map(p => p.user_id!);
  const initialGuests = lineup.players.filter(p => p.is_guest).map(p => p.id);
  const dirty = selected.length !== initialMembers.length || initialMembers.some(id => !selected.includes(id))
    || guests.length !== initialGuests.length || guests.some(g => !g.id);
  const count = selected.length + guests.length;
  const hint = countHint(count, lineup.min_players, lineup.simples);
  const mixed = lineup.genre === 'mixte' ? mixedCountLabel([...selected.map(id => person(id).sex ?? null), ...guests.map(g => g.sex)]) : null;
  const outOfGenre = (sex: LineupSex | undefined) => expected && sex && sex !== expected && genreLabel ? `${sex === 'female' ? 'Femme' : 'Homme'} · ${genreLabel}` : null;

  const list = candidates ?? [];
  const counts = { all: list.length, male: list.filter(c => c.sex === 'male').length, female: list.filter(c => c.sex === 'female').length };
  // Une recherche parcourt tout le club : la puce « Tous » le montre (même règle que l'app).
  const applied: Filter = search.trim() ? 'all' : filter;
  const shown = list.filter(c => search.trim() ? matches(c, search) : filter === 'all' || c.sex === filter);
  const compo = [
    ...selected.map(id => ({ key: id, kind: 'member' as const, id, p: person(id) })),
    ...guests.map(g => ({ key: g.key, kind: 'guest' as const, id: g.key, p: g })),
  ].sort((a, b) => compoNameKey(`${a.p.nom} ${a.p.prenom}`).localeCompare(compoNameKey(`${b.p.nom} ${b.p.prenom}`)));

  const toggle = (id: string) => { setError(null); setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]); };
  const addGuest = () => {
    const { prenom, nom } = splitGuestName(guestName);
    if (!prenom) return;
    const key = compoNameKey(`${prenom} ${nom}`);
    const member = list.find(c => compoNameKey(fullName(c)) === key || compoNameKey(`${c.nom} ${c.prenom}`) === key);
    if (member) { setGuestError(T.boMemberExists(fullName(member))); return; }
    const same = guests.find(g => compoNameKey(fullName(g)) === key);
    if (same) { setGuestError(T.duplicate(fullName(same))); return; }
    setGuests(prev => [...prev, { key: `new-${prev.length}-${key}`, prenom, nom, sex: guestSex }]);
    setGuestName('');
    setGuestSex(expected);
    setGuestError('');
  };
  const save = async () => {
    if (saving) return;
    if (!lineupEditable(lineup)) { setError({ message: T.cannotEdit, stale: false }); return; }
    const gone = selected.filter(leftClub).map(id => fullName(person(id)));
    if (gone.length) { setError({ message: T.notMemberError(gone), stale: false }); return; }
    setSaving(true);
    setError(null);
    const entries: LineupEntry[] = [...selected.map(user_id => ({ user_id })),
      ...guests.map(g => g.id ? { id: g.id } : { prenom: g.prenom, nom: g.nom, sex: g.sex })];
    try {
      reset(await saveLineup(clubId, rencontreId, entries, lineup.version));
      setSaved(true);
    } catch (e) {
      setError({ message: compoErrorMessage(e, { offline: navigator.onLine === false }), stale: isStaleCompo(e) });
    } finally {
      setSaving(false);
    }
  };

  const header = <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{T.title} · {playersLabel(count)}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {[lineup.simples != null && lineup.doubles != null ? T.sheetSubtitle(lineup.simples, lineup.doubles) : null, genreLabel].filter(Boolean).join(' · ')}
      </p>
      {lineup.updated_at && <p className="mt-1 text-xs text-muted-foreground">{updatedLine(lineup.updated_at, lineup.updated_by)}</p>}
    </div>
    {lineup.can_edit && dirty && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">{T.boUnsaved}</span>}
    {saved && <span role="status" className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900">{T.saved}</span>}
  </div>;

  // Lecture seule (manager sans droit de compo) : la liste, sans édition.
  if (!lineup.can_edit) return <section className="rounded-2xl border bg-card/90 p-6 shadow-sm">
    {header}
    <p className="mb-3 text-sm text-muted-foreground">{T.boReadOnly}</p>
    {lineup.players.length ? <ul className="divide-y divide-border">{lineup.players.map(p =>
      <li key={p.id} className="flex items-center justify-between py-2 text-sm"><span>{fullName(p)}{p.is_guest ? ` · ${T.guest}` : ''}{p.is_captain ? ` · ${T.captain}` : ''}</span>
        {p.classement && <span className="rounded bg-muted px-2 py-0.5 font-semibold tabular-nums">{p.classement}</span>}</li>)}</ul>
      : <p className="text-sm text-muted-foreground">{T.emptyTitle}</p>}
  </section>;

  return <section className="rounded-2xl border bg-card/90 p-6 shadow-sm">
    {header}
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_17rem]">
      {/* Membres du club */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">{T.boMembers}</h3>
          {candidates && <p className="text-xs text-muted-foreground">{T.boMembersHint(list.length)}</p>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={T.boSearch} aria-label={T.boSearch}
            className="min-h-11 w-full basis-full rounded-lg border border-border bg-background px-3 text-sm" />
          {candidates && <div role="radiogroup" aria-label={T.filterLabel} className="flex gap-1">
            {(['all', 'male', 'female'] as const).map(key => <button key={key} type="button" role="radio" aria-checked={applied === key}
              onClick={() => { setFilter(key); setSearch(''); }}
              className={`min-h-11 rounded-full border px-3 text-sm font-semibold ${applied === key ? 'border-foreground bg-foreground text-background' : 'border-border bg-card'}`}>
              {T.filters[key]} <span className="font-medium opacity-70">{counts[key]}</span>
            </button>)}
          </div>}
        </div>
        {candidatesError && <p role="alert" className="mt-3 flex items-center justify-between gap-3 text-sm text-red-700">
          {T.candidatesError}<button className="min-h-11 px-2 font-semibold underline" onClick={() => void load()}>{T.retry}</button>
        </p>}
        {!candidates && !candidatesError && <div className="mt-3 h-40 animate-pulse rounded-lg bg-muted" aria-label="Chargement des membres…" />}
        {candidates && <div className="mt-3 max-h-[28rem] overflow-y-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
              <tr><th className="w-10 p-2"><span className="sr-only">Retenu</span></th><th className="p-2 font-medium">Membre</th><th className="p-2 font-medium">Class.</th><th className="p-2 font-medium">Sexe</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map(c => {
                const checked = selected.includes(c.id);
                const notes = [c.is_captain && T.captain.toLowerCase(), !c.classement && T.rankUnknown.toLowerCase(), checked && outOfGenre(c.sex)].filter(Boolean).join(' · ');
                return <tr key={c.id} className={checked ? 'bg-muted/50' : ''}>
                  <td className="p-2"><input type="checkbox" className="h-5 w-5 accent-primary" checked={checked} onChange={() => toggle(c.id)} aria-label={`${fullName(c)}${notes ? `, ${notes}` : ''}`} /></td>
                  <td className="p-2"><span className="font-medium">{fullName(c)}</span>{notes && <span className="text-muted-foreground"> · {notes}</span>}</td>
                  <td className="p-2">{c.classement && <span className="rounded bg-muted px-2 py-0.5 font-semibold tabular-nums">{c.classement}</span>}</td>
                  <td className="p-2 text-muted-foreground">{c.sex ? SEX_SHORT[c.sex] : '—'}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>}
      </div>

      {/* Compo */}
      <div className="flex min-w-0 flex-col gap-3">
        {compo.length === 0 ? <p className="text-sm text-muted-foreground">{T.boEmpty}</p>
          : <ul aria-label={`Compo, ${playersLabel(compo.length)}`} className="divide-y divide-border">
            {compo.map(({ key, kind, id, p }) => {
              const guest = kind === 'guest';
              const sub = guest ? [T.guest, sexWord(p.sex ?? null)].filter(Boolean).join(' · ')
                : leftClub(id) ? T.notMember : [(p as LineupCandidate).is_captain && T.captain, outOfGenre(p.sex)].filter(Boolean).join(' · ');
              return <li key={key} className="flex items-center gap-2 py-2">
                <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${guest ? 'border border-dashed border-muted-foreground text-muted-foreground' : 'bg-muted'}`}>{initials(p)}</span>
                <span className="min-w-0 flex-1 text-sm"><span className="block truncate font-medium">{fullName(p)}</span>{sub && <span className="block text-xs text-muted-foreground">{sub}</span>}</span>
                {!guest && (p as LineupCandidate).classement && <span className="rounded bg-muted px-2 py-0.5 text-sm font-semibold tabular-nums">{(p as LineupCandidate).classement}</span>}
                <button type="button" aria-label={`Retirer ${fullName(p)}`} onClick={() => guest ? setGuests(prev => prev.filter(g => g.key !== key)) : toggle(id)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted">✕</button>
              </li>;
            })}
          </ul>}

        <div className="rounded-lg border border-dashed border-border p-3">
          <p className="text-sm font-semibold" id="bo-guest">{T.boGuestTitle}</p>
          <input value={guestName} onChange={e => { setGuestName(e.target.value); setGuestError(''); }} placeholder={T.boGuestName} aria-labelledby="bo-guest"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addGuest(); } }}
            className="mt-2 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm" />
          <div className="mt-2 flex gap-2">
            <select value={guestSex ?? ''} onChange={e => setGuestSex((e.target.value || null) as LineupSex)} aria-label={T.guestSex}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm">
              {T.sexOptions.map(([value, label]) => <option key={label} value={value}>{value ? label : `${T.guestSex} : non précisé`}</option>)}
            </select>
            <button type="button" onClick={addGuest} className="min-h-11 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted">{T.add}</button>
          </div>
          {guestError && <p role="alert" className="mt-2 text-sm text-red-700">{guestError}</p>}
        </div>

        <p role="status" className={`rounded-lg bg-muted p-3 text-sm ${hint.short ? 'font-semibold text-orange-800' : ''}`}>{mixed ? `${mixed}${hint.short ? ` · ${hint.text}` : ''}` : hint.text}</p>
        <p className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900">{T.boSameRules}</p>
        {error && <div role="alert" className="text-sm text-red-700">{error.message}
          {error.stale && <button onClick={() => void load()} className="ml-2 min-h-11 font-semibold underline">{T.reload}</button>}</div>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" disabled={!dirty || saving} onClick={() => reset(lineup)} className="min-h-11 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted disabled:opacity-50">{T.boCancel}</button>
          <button type="button" onClick={() => void save()} aria-busy={saving} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:brightness-95">{saving ? T.saving : T.save}</button>
        </div>
      </div>
    </div>
  </section>;
}
