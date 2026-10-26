import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface RosterMember {
  id: string;
  prenom: string;
  nom: string;
}

interface Props {
  clubId: string;
  equipeId: string;
}

// Capitaines de l'équipe : membres du club autorisés à changer la date des rencontres depuis la PWA.
export default function TeamCaptainsSection({ clubId, equipeId }: Props) {
  const [captainIds, setCaptainIds] = useState<string[]>([]);
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [captains, members] = await Promise.all([
        supabase.from('team_equipe_captains').select('user_id').eq('club_id', clubId).eq('equipe_id', equipeId),
        supabase.rpc('team_member_roster', { p_club: clubId }),
      ]);
      if (captains.error) throw captains.error;
      if (members.error) throw members.error;
      setCaptainIds((captains.data ?? []).map((row) => row.user_id as string));
      setRoster((members.data ?? []) as RosterMember[]);
    } catch {
      setError('Impossible de charger les capitaines.');
    }
  }, [clubId, equipeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const byId = useMemo(() => Object.fromEntries(roster.map((m) => [m.id, m])), [roster]);
  const candidates = roster.filter((m) => !captainIds.includes(m.id));

  const add = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    const { error: err } = await supabase
      .from('team_equipe_captains')
      .insert({ club_id: clubId, equipe_id: equipeId, user_id: selected });
    setBusy(false);
    if (err) {
      setError('Impossible d’ajouter ce capitaine.');
      return;
    }
    setSelected('');
    void load();
  };

  const remove = async (userId: string) => {
    setBusy(true);
    setError('');
    const { error: err } = await supabase
      .from('team_equipe_captains')
      .delete()
      .eq('club_id', clubId)
      .eq('equipe_id', equipeId)
      .eq('user_id', userId);
    setBusy(false);
    if (err) {
      setError('Impossible de retirer ce capitaine.');
      return;
    }
    void load();
  };

  return (
    <section>
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-primary">Capitaines</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Ils peuvent changer la date des rencontres de l’équipe depuis l’app. À redéclarer à chaque saison.
      </p>

      <div className="space-y-3 rounded-xl border bg-card/90 p-4">
        {captainIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun capitaine déclaré.</p>
        ) : (
          <ul className="divide-y divide-border">
            {captainIds.map((userId) => {
              const member = byId[userId];
              return (
                <li key={userId} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>{member ? `${member.prenom} ${member.nom}` : 'Ancien membre du club'}</span>
                  <button
                    onClick={() => remove(userId)}
                    disabled={busy}
                    className="rounded-lg border px-3 py-1 text-sm text-destructive transition hover:bg-destructive/10 disabled:opacity-60"
                  >
                    Retirer
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm"
          >
            <option value="">Choisir un membre…</option>
            {candidates.map((m) => (
              <option key={m.id} value={m.id}>
                {m.prenom} {m.nom}
              </option>
            ))}
          </select>
          <button
            onClick={add}
            disabled={busy || !selected}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-60"
          >
            Ajouter
          </button>
        </div>

        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </div>
    </section>
  );
}
