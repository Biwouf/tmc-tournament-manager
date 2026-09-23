import { useState } from 'react';
import type { LiveMatch } from '../../types';
import { lineLabel, liveSets, playerLabel, resultWinner, setWinner, type TeamLine, type TeamSet } from '../../lib/teamMatches';
import { useTeamAction } from '../../hooks/useTeamAction';
import TeamSheet from './TeamSheet';

type Kind = 'normal' | 'wo' | 'retired';
export default function TeamResultSheet({ line, live, clubId, userId, onClose }: {
  line: TeamLine; live?: LiveMatch; clubId: string; userId: string; onClose: () => void;
}) {
  // Keep the opened revision until submission. Background polling must not silently
  // turn a stale form into a write against a newer score.
  const [base] = useState({ line, live });
  const initialSets = base.live ? liveSets(base.live) : base.line.sets;
  const [kind, setKind] = useState<Kind>(base.line.result_kind ?? (base.live?.retired_player ? 'retired' : 'normal'));
  const [values, setValues] = useState(() => Array.from({ length: 3 }, (_, i) => ({
    club: initialSets[i]?.club.toString() ?? '', adverse: initialSets[i]?.adverse.toString() ?? '',
    tb_club: initialSets[i]?.tb_club, tb_adverse: initialSets[i]?.tb_adverse,
  })));
  const [specialWinner, setSpecialWinner] = useState<'club' | 'adverse' | ''>(base.line.gagnant ?? (base.live?.winner === 'j1' ? 'club' : base.live?.winner === 'j2' ? 'adverse' : ''));
  const [takeover, setTakeover] = useState(false);
  const action = useTeamAction(clubId, line.rencontre_id);
  const parsed = values.map(v => ({ ...v, club: v.club === '' ? NaN : Number(v.club), adverse: v.adverse === '' ? NaN : Number(v.adverse) }));
  const split = !!setWinner(parsed[0]) && !!setWinner(parsed[1]) && setWinner(parsed[0]) !== setWinner(parsed[1]);
  const count = split ? 3 : 2;
  const lastStarted = values.slice(0, count).reduce((last, v, i) => v.club !== '' || v.adverse !== '' ? i : last, -1);
  const used = kind === 'wo' ? [] : parsed.slice(0, kind === 'retired' ? lastStarted + 1 : count);
  const validNumbers = used.every(s => [s.club, s.adverse].every(n => Number.isInteger(n) && n >= 0 && n <= 32767));
  const winner = kind === 'normal' ? resultWinner(used, base.line.set3_format) : specialWinner;
  const mustTakeover = base.live?.status === 'live' && base.live.scored_by !== userId;
  const canSubmit = !!winner && validNumbers && (!mustTakeover || takeover);
  const update = (i: number, side: 'club' | 'adverse', value: string) => setValues(old => old.map((v, n) => n === i ? { ...v, [side]: value, tb_club: undefined, tb_adverse: undefined } : v));
  const submit = async () => {
    if (!canSubmit) return;
    const sets: TeamSet[] = used.map(s => ({ club: s.club, adverse: s.adverse, tb_club: s.tb_club ?? null, tb_adverse: s.tb_adverse ?? null }));
    if (await action.run('result', { id: base.line.id, revision: base.line.revision, live_revision: base.live?.revision,
      kind, sets, winner, takeover })) onClose();
  };
  return <TeamSheet title={`Résultat · ${lineLabel(line)}`} onClose={onClose} busy={action.busy}>
    <p className="mb-4 text-sm text-muted-foreground">{base.live ? 'Score du live prérempli. Vérifiez-le avant de confirmer.' : 'Saisissez le score final du point de vue du club.'}</p>
    {line.score && !base.live && !line.sets.length && <p className="mb-3 rounded-lg bg-muted p-3 text-sm">Ancien résultat à vérifier : {line.score}</p>}
    <label className="block text-sm font-medium">Fin du match
      <select value={kind} onChange={e => setKind(e.target.value as Kind)} className="my-2 min-h-11 w-full rounded-lg border border-border bg-background px-3">
        <option value="normal">Match terminé</option><option value="wo">WO · match non joué</option><option value="retired">Abandon</option>
      </select>
    </label>
    {kind !== 'wo' && <>
      <div className="my-3 grid grid-cols-2 gap-3 text-center text-xs font-semibold"><span>{playerLabel(line.joueurs_club)}</span><span>{playerLabel(line.joueurs_adverse)}</span></div>
      {values.slice(0, count).map((v, i) => <fieldset key={i} className="mb-3 rounded-xl border border-border p-3">
        <legend className="px-2 text-sm">{i === 2 && line.set3_format === 'super_tiebreak' ? 'Super tie-break · 10 points' : `Set ${i + 1}`}</legend>
        <div className="grid grid-cols-2 gap-3">{(['club', 'adverse'] as const).map(side => <input key={side} type="number" inputMode="numeric" min="0" max={i === 2 && line.set3_format === 'super_tiebreak' ? 32767 : 7} step="1"
          aria-label={`${side === 'club' ? 'Club' : 'Adversaire'} · set ${i + 1}`} value={v[side]} onChange={e => update(i, side, e.target.value)}
          className="min-h-12 w-full rounded-lg border border-border bg-background text-center text-xl font-semibold" />)}</div>
        {v.tb_club != null && v.tb_adverse != null && <p className="mt-2 text-center text-xs text-muted-foreground">Tie-break : {v.tb_club}–{v.tb_adverse}</p>}
      </fieldset>)}
      {kind === 'retired' && <p className="mb-3 text-xs text-muted-foreground">Renseignez uniquement les sets commencés ; laissez les suivants vides.</p>}
    </>}
    {kind !== 'normal' && <fieldset className="my-3"><legend className="mb-2 text-sm font-medium">Qui gagne le match ?</legend>
      {(['club', 'adverse'] as const).map(side => <label key={side} className="flex min-h-11 items-center gap-2">
        <input type="radio" name="winner" checked={specialWinner === side} onChange={() => setSpecialWinner(side)} />{side === 'club' ? playerLabel(line.joueurs_club) : playerLabel(line.joueurs_adverse)}
      </label>)}
    </fieldset>}
    {winner && <p className="my-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Vainqueur : {winner === 'club' ? playerLabel(line.joueurs_club) : playerLabel(line.joueurs_adverse)}</p>}
    {mustTakeover && <label className="my-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><input className="mt-1" type="checkbox" checked={takeover} onChange={e => setTakeover(e.target.checked)} />Je reprends ce live et le termine avec ce résultat. L’autre marqueur passera en lecture seule.</label>}
    {action.error && <p role="alert" className="my-3 text-sm text-red-700">{action.error} En cas de changement, fermez puis rouvrez la saisie pour vérifier le dernier score.</p>}
    <button disabled={action.busy || !canSubmit} onClick={() => void submit()} className="min-h-12 w-full rounded-xl bg-primary p-3 font-semibold text-primary-foreground disabled:opacity-40">{action.busy ? 'Enregistrement…' : 'Confirmer le résultat'}</button>
  </TeamSheet>;
}
