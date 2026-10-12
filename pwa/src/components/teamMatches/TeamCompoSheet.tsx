import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import type { TeamDetail, TeamPlayer } from '../../lib/teamMatches';
import { COMPO_RANKS, PROFILE_RANKS, matchMember, type CompoEntry, type RosterMember } from '../../lib/teamCompo';
import { scanCompoPhoto } from '../../lib/compoScan';
import { useTeamAction } from '../../hooks/useTeamAction';
import TeamSheet from './TeamSheet';

type Row = TeamPlayer & { updateRank: boolean };
type Side = 0 | 1;
const empty = (): Row => ({ prenom: '', nom: '', classement: 'NC', updateRank: true });
const filled = (row: Row) => `${row.prenom}${row.nom}`.trim().length > 0;
const field = 'mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3';

/** Compo des simples par photo : feuille de notre équipe, puis feuille adverse, puis vérification. */
export default function TeamCompoSheet({ detail, clubId, slots, onClose }: {
  detail: TeamDetail; clubId: string; slots: number[]; onClose: () => void;
}) {
  const [side, setSide] = useState<Side | 'review'>(0);
  const [rows, setRows] = useState<Row[][]>(() => [slots.map(empty), slots.map(empty)]);
  const [read, setRead] = useState(['', '']);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const action = useTeamAction(clubId, detail.rencontre.id);
  const roster = useQuery({
    queryKey: ['team-roster', clubId], staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('team_member_roster', { p_club: clubId });
      if (error) throw error;
      return (data ?? []) as RosterMember[];
    },
  });
  const members = roster.data ?? [];
  const rankChange = (row: Row) => {
    const member = members.find(m => m.id === row.member_id);
    return member && member.classement !== row.classement && PROFILE_RANKS.includes(row.classement) ? member : null;
  };
  const setRow = (s: Side, index: number, row: Row) => setRows(previous => previous.map((list, i) => i === s ? list.map((old, j) => j === index ? row : old) : list));

  const fill = (s: Side, entries: CompoEntry[], roster: RosterMember[]) => {
    let found = 0;
    const next = slots.map(slot => {
      const entry = entries.find(e => e.ordre === slot);
      if (!entry) return empty();
      found++;
      const player: Row = { prenom: entry.prenom, nom: entry.nom, classement: entry.classement ?? 'NC', updateRank: true };
      const member = s === 0 ? matchMember(entry, roster) : null;
      return member ? { ...player, prenom: member.prenom, nom: member.nom, member_id: member.id } : player;
    });
    setRows(previous => previous.map((list, i) => i === s ? next : list));
    setRead(previous => previous.map((text, i) => i === s ? `${found}/${slots.length} joueur${found > 1 ? 's' : ''} lu${found > 1 ? 's' : ''}` : text));
  };

  // Après une reprise de photo depuis la vérification, on y reste.
  const scan = async (s: Side, file: File, next: Side | 'review' = s === 0 ? 1 : 'review') => {
    setScanning(true); setScanError('');
    try {
      const [entries, list] = await Promise.all([scanCompoPhoto(clubId, file), s === 0 ? roster.refetch().then(r => r.data ?? []) : Promise.resolve(members)]);
      fill(s, entries, list);
      setSide(next);
    } catch (e) { setScanError(e instanceof Error ? e.message : 'Lecture de la photo impossible.'); }
    finally { setScanning(false); }
  };
  const submit = async () => {
    const player = ({ prenom, nom, classement, member_id }: Row): TeamPlayer => ({ prenom: prenom.trim(), nom: nom.trim(), classement, ...(member_id ? { member_id } : {}) });
    const simples = slots.map((slot, i) => ({
      slot, joueur_club: player(rows[0][i]), joueur_adverse: player(rows[1][i]),
      update_classement: !!rankChange(rows[0][i]) && rows[0][i].updateRank,
    }));
    if (await action.compose({ simples })) onClose();
  };

  const team = (s: Side) => s === 0 ? 'notre équipe' : detail.rencontre.club_adverse;
  const steps = ['Photo de notre compo', `Photo de la compo de ${detail.rencontre.club_adverse}`, 'Vérification'];
  const current = side === 'review' ? 2 : side;
  const photoInput = (s: Side, label: string, primary: boolean) => <label className={`flex min-h-12 w-full cursor-pointer items-center justify-center rounded-lg px-4 font-semibold ${primary ? 'bg-primary text-primary-foreground' : 'border border-primary text-primary'}`}>
    {label}
    <input type="file" accept="image/*" capture="environment" className="sr-only"
      onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void scan(s, file, side === 'review' ? 'review' : undefined); }} />
  </label>;
  const playerFields = (s: Side, row: Row, index: number) => {
    const change = s === 0 ? rankChange(row) : null;
    return <div className="space-y-2">
      <p className="text-xs font-semibold uppercase text-muted-foreground">{s === 0 ? 'Notre joueur' : `Adversaire · ${detail.rencontre.club_adverse}`}</p>
      {s === 0 && <label className="block text-sm">Membre du club
        <select value={row.member_id ?? ''} className={field} onChange={e => {
          const member = members.find(m => m.id === e.target.value);
          setRow(0, index, member ? { ...row, prenom: member.prenom, nom: member.nom, member_id: member.id } : { ...row, member_id: undefined });
        }}>
          <option value="">Non membre / non reconnu</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.prenom} {m.nom}{m.classement ? ` · ${m.classement}` : ''}</option>)}
        </select>
      </label>}
      <div className="grid grid-cols-[1fr_1fr_6rem] gap-2">
        <label className="block text-sm">Prénom
          <input autoComplete="off" maxLength={60} value={row.prenom} className={field} onChange={e => setRow(s, index, { ...row, prenom: e.target.value, member_id: undefined })} />
        </label>
        <label className="block text-sm">Nom
          <input autoComplete="off" maxLength={60} value={row.nom} className={field} onChange={e => setRow(s, index, { ...row, nom: e.target.value, member_id: undefined })} />
        </label>
        <label className="block text-sm">Classement
          <select value={row.classement} className={field} onChange={e => setRow(s, index, { ...row, classement: e.target.value, updateRank: true })}>
            {COMPO_RANKS.map(rank => <option key={rank}>{rank}</option>)}
          </select>
        </label>
      </div>
      {change && <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-5 w-5" checked={row.updateRank} onChange={e => setRow(0, index, { ...row, updateRank: e.target.checked })} />
        Mettre à jour la fiche du membre : {change.classement ?? 'non renseigné'} → {row.classement}
      </label>}
    </div>;
  };

  const complete = rows.every(list => list.every(filled));
  return <TeamSheet title="Compo par photo" onClose={onClose} busy={action.busy || scanning}>
    <ol className="mb-5 space-y-2" aria-label="Étapes">
      {steps.map((label, index) => <li key={label} aria-current={index === current ? 'step' : undefined}
        className={`flex items-center gap-3 rounded-lg p-2 text-sm ${index === current ? 'bg-primary/10 font-semibold' : index < current ? 'text-muted-foreground' : 'text-muted-foreground opacity-60'}`}>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${index < current ? 'bg-primary text-primary-foreground' : index === current ? 'border-2 border-primary text-primary' : 'border border-border'}`}>{index < current ? '✓' : index + 1}</span>
        <span>{label}{index < 2 && read[index] ? ` · ${read[index]}` : ''}</span>
      </li>)}
    </ol>
    {side !== 'review' ? <div className="space-y-4">
      <p className="text-sm">{side === 0
        ? <>Chaque capitaine écrit la compo de ses simples sur une feuille. Commencez par photographier <strong>la feuille de notre équipe</strong>, puis vous photographierez celle de l’adversaire.</>
        : <>Photographiez maintenant <strong>la feuille de {detail.rencontre.club_adverse}</strong>.</>}</p>
      {scanning ? <p role="status" className="rounded-lg bg-muted p-4 text-center font-semibold">Lecture de la feuille de {team(side)}…</p>
        : <>
          {scanError && <p role="alert" className="text-sm text-red-700">{scanError}</p>}
          {photoInput(side, scanError ? 'Reprendre la photo' : side === 0 ? 'Photographier notre compo' : `Photographier la compo de ${detail.rencontre.club_adverse}`, true)}
        </>}
      <p className="text-xs text-muted-foreground">Cadrez la feuille entière, à plat et bien éclairée. Seuls les simples numérotés sont lus ; la partie double est ignorée.</p>
    </div> : <div className="space-y-4">
      <p className="text-sm">Vérifiez chaque simple, corrigez si besoin, puis validez.</p>
      {roster.isError && <p role="alert" className="text-sm text-amber-800">Liste des membres indisponible : les joueurs seront enregistrés sans lien avec leur fiche.</p>}
      {slots.map((slot, index) => <fieldset key={slot} className="space-y-3 rounded-xl border border-border p-3">
        <legend className="px-2 text-sm font-semibold">Simple {slot}</legend>
        {playerFields(0, rows[0][index], index)}
        {playerFields(1, rows[1][index], index)}
      </fieldset>)}
      {scanning && <p role="status" className="rounded-lg bg-muted p-3 text-center text-sm font-semibold">Lecture de la feuille…</p>}
      {scanError && <p role="alert" className="text-sm text-red-700">{scanError}</p>}
      <div className="grid grid-cols-2 gap-2">
        {photoInput(0, 'Reprendre notre feuille', false)}
        {photoInput(1, 'Reprendre la feuille adverse', false)}
      </div>
      {!complete && <p className="text-sm text-amber-800">Complétez les joueurs manquants avant de valider.</p>}
      {action.error && <p role="alert" className="text-sm text-red-700">{action.error}</p>}
      <button disabled={action.busy || scanning || !complete} onClick={() => void submit()} className="min-h-12 w-full rounded-lg bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-40">
        {action.busy ? 'Création…' : 'Valider la compo'}
      </button>
    </div>}
  </TeamSheet>;
}
