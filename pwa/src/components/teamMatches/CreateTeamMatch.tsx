import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { TEAM_FORMATS, type TeamDetail, type TeamPlayer } from '../../lib/teamMatches';
import { useTeamAction } from '../../hooks/useTeamAction';
import TeamSheet from './TeamSheet';

const ranks = [
  { label: '3e série', values: ['30', '15/5', '15/4', '15/3', '15/2', '15/1'] },
  { label: '2e série', values: ['15', '5/6', '4/6', '3/6', '2/6', '1/6', '0', '-2/6', '-4/6', '-15', '-30'] },
  { label: '4e série', values: ['NC', '40', '30/5', '30/4', '30/3', '30/2', '30/1'] },
];
const empty = (): TeamPlayer => ({ prenom: '', nom: '', classement: 'NC' });
const validPlayers = (players: TeamPlayer[]) => players.every(p => `${p.prenom} ${p.nom}`.trim().length > 0);
// Même joueur : même membre, sinon même nom affiché.
const playerKey = (p: TeamPlayer) => p.member_id ?? `${p.prenom} ${p.nom ?? ''}`.trim().toLowerCase();

function PlayerFields({ value, onChange, clubId, index }: {
  value: TeamPlayer; onChange: (p: TeamPlayer) => void; clubId?: string; index: number;
}) {
  const name = `${value.prenom}${value.nom ? ` ${value.nom}` : ''}`;
  const [suggestions, setSuggestions] = useState<{ id: string; prenom: string; nom: string }[]>([]);
  const [searchError, setSearchError] = useState(false);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setSearchError(false);
      if (!clubId || name.trim().length < 2 || value.member_id) { setSuggestions([]); return; }
      const { data, error } = await supabase.rpc('team_member_search', { p_club: clubId, p_search: name });
      if (active) {
        setSuggestions(error ? [] : data ?? []);
        setSearchError(!!error);
      }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [clubId, name, value.member_id]);
  return <fieldset className="space-y-3 rounded-xl border border-border p-3">
    <legend className="px-2 text-sm font-semibold">Joueur {index + 1}</legend>
    <label className="block text-sm">Nom du joueur
      <input autoComplete="off" maxLength={120} value={name} onChange={e => onChange({ prenom: e.target.value, nom: '', classement: value.classement })}
        className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3" placeholder={clubId ? 'Nom libre ou recherche membre' : 'Prénom et nom'} />
    </label>
    {searchError && <p role="alert" className="text-sm text-red-700">Recherche des membres indisponible. Réessayez en modifiant le nom, ou saisissez-le librement.</p>}
    {suggestions.length > 0 && <ul className="rounded-lg border border-border">{suggestions.map(p => <li key={p.id}>
      <button type="button" className="min-h-11 w-full px-3 text-left hover:bg-muted" onClick={() => { onChange({ ...value, prenom: p.prenom, nom: p.nom, member_id: p.id }); setSuggestions([]); }}>{p.prenom} {p.nom}</button>
    </li>)}</ul>}
    {value.member_id && <p className="text-xs text-muted-foreground">Membre du club associé · classement du jour à vérifier</p>}
    <p className="text-sm font-medium">Classement : {value.classement}</p>
    {ranks.map(group => <div key={group.label}>
      <p className="mb-1 text-xs text-muted-foreground">{group.label}</p>
      <div className="grid grid-cols-6 gap-1">{group.values.map(rank => <button type="button" key={rank} aria-pressed={value.classement === rank}
        onClick={() => onChange({ ...value, classement: rank })}
        className={`min-h-11 rounded-lg border text-xs font-semibold ${value.classement === rank ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background'}`}>{rank}</button>)}</div>
    </div>)}
  </fieldset>;
}

export default function CreateTeamMatch({ detail, clubId, onClose }: { detail: TeamDetail; clubId: string; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [place, setPlace] = useState<{ type: 'simple' | 'double'; slot: number } | null>(null);
  const [club, setClub] = useState<TeamPlayer[]>([empty()]);
  const [adverse, setAdverse] = useState<TeamPlayer[]>([empty()]);
  // Places remplies d'un tap parmi les joueurs des simples (`<étape>-<place>`).
  const [fromSingles, setFromSingles] = useState<string[]>([]);
  const action = useTeamAction(clubId, detail.rencontre.id);
  const spec = TEAM_FORMATS[detail.competition.format];
  const choose = (type: 'simple' | 'double', slot: number) => {
    if (place?.type !== type) {
      setClub(previous => type === 'double' ? [previous[0], empty()] : previous.slice(0, 1));
      setAdverse(previous => type === 'double' ? [previous[0], empty()] : previous.slice(0, 1));
      setFromSingles([]);
    }
    setPlace({ type, slot });
  };
  const submit = async () => {
    if (!place || !validPlayers(club) || !validPlayers(adverse)) return;
    if (await action.run('create', { match_type: place.type, slot: place.slot, joueurs_club: club, joueurs_adverse: adverse })) onClose();
  };
  // Double : les joueurs alignés en simple dans cette rencontre se choisissent d'un tap.
  const players = step === 1 ? club : adverse;
  const setPlayers = step === 1 ? setClub : setAdverse;
  const picks = place?.type !== 'double' ? [] : detail.lines
    .filter(l => l.match_type === 'simple').flatMap(l => step === 1 ? l.joueurs_club : l.joueurs_adverse)
    .filter((p, i, all) => all.findIndex(o => playerKey(o) === playerKey(p)) === i);
  const picked = (index: number) => fromSingles.includes(`${step}-${index}`);
  const pickedSlot = (pick: TeamPlayer) => players.findIndex((p, i) => picked(i) && playerKey(p) === playerKey(pick));
  // Un tap retire le joueur s'il est choisi, sinon le place à la première place libre
  // (vide d'abord, puis saisie libre en cours).
  const togglePick = (pick: TeamPlayer) => {
    const chosen = pickedSlot(pick);
    const blank = players.findIndex((p, i) => !picked(i) && !`${p.prenom} ${p.nom}`.trim());
    const target = chosen >= 0 ? chosen : blank >= 0 ? blank : players.findIndex((_, i) => !picked(i));
    if (target < 0) return;
    const slot = `${step}-${target}`;
    setPlayers(previous => previous.map((p, i) => i !== target ? p : chosen >= 0 ? empty() : { ...pick, nom: pick.nom ?? '' }));
    setFromSingles(previous => chosen >= 0 ? previous.filter(k => k !== slot) : [...previous, slot]);
  };
  const full = players.every((_, i) => picked(i));
  const canContinue = step === 0 ? !!place : step === 1 ? validPlayers(club) : validPlayers(adverse);
  return <TeamSheet title="Ajouter un match" onClose={onClose} busy={action.busy}>
    <p className="mb-4 text-sm text-muted-foreground">Étape {step + 1}/3 · {['Place dans la rencontre', 'Joueurs du club', 'Adversaires'][step]}</p>
    {step === 0 ? <div className="space-y-2">
      {(['simple', 'double'] as const).flatMap(type => Array.from({ length: type === 'simple' ? spec.simples : spec.doubles }, (_, i) => {
        const used = detail.lines.some(l => l.match_type === type && l.slot === i + 1);
        const missingRule = type === 'simple' && !detail.competition.singles_set3_format;
        return <button type="button" key={`${type}${i}`} disabled={used || missingRule} aria-pressed={place?.type === type && place.slot === i + 1}
          onClick={() => choose(type, i + 1)} className={`min-h-12 w-full rounded-xl border p-3 text-left disabled:opacity-40 ${place?.type === type && place.slot === i + 1 ? 'border-primary bg-primary/10' : 'border-border'}`}>
          {type === 'simple' ? 'Simple' : 'Double'} {i + 1}{used ? ' · Déjà créé' : missingRule ? ' · Règle à configurer' : ''}
        </button>;
      }))}
      {!detail.competition.singles_set3_format && <p className="text-sm text-amber-800">Le troisième set des simples doit être renseigné dans l’administration de la compétition.</p>}
    </div> : <div className="space-y-4">
      {picks.length > 0 && <div>
        <p className="mb-2 text-sm font-medium">Ont joué un simple</p>
        <div className="flex flex-wrap gap-2">{picks.map(pick => {
          const slot = pickedSlot(pick);
          return <button type="button" key={playerKey(pick)} aria-pressed={slot >= 0} disabled={slot < 0 && full} onClick={() => togglePick(pick)}
            className={`min-h-11 rounded-full border px-3 text-sm disabled:opacity-40 ${slot >= 0 ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background'}`}>
            {slot >= 0 && <span className="mr-1 font-semibold">{slot + 1}.</span>}{`${pick.prenom} ${pick.nom ?? ''}`.trim()} · {pick.classement}
          </button>;
        })}</div>
      </div>}
      {players.map((p, index) => picked(index)
        ? <div key={`${step}-${index}`} className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-border px-3 text-sm">
          <span><span className="font-semibold">Joueur {index + 1}</span> · {`${p.prenom} ${p.nom ?? ''}`.trim()} · {p.classement}</span>
          <button type="button" onClick={() => togglePick(p)} className="min-h-11 px-2 text-primary">Retirer</button>
        </div>
        : <PlayerFields key={`${step}-${index}`} index={index} value={p} clubId={step === 1 ? clubId : undefined}
          onChange={value => setPlayers(previous => previous.map((old, i) => i === index ? value : old))} />)}
    </div>}
    {action.error && <p role="alert" className="mt-3 text-sm text-red-700">{action.error}</p>}
    <div className="mt-5 flex gap-3">
      {step > 0 && <button disabled={action.busy} onClick={() => setStep(step - 1)} className="min-h-11 rounded-lg border border-border px-4">Retour</button>}
      <button disabled={action.busy || !canContinue} onClick={() => step < 2 ? setStep(step + 1) : void submit()}
        className="min-h-11 flex-1 rounded-lg bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-40">{action.busy ? 'Création…' : step < 2 ? 'Continuer' : 'Créer le match'}</button>
    </div>
  </TeamSheet>;
}
