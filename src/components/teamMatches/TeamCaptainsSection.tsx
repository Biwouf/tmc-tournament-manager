import { useCallback, useEffect, useMemo, useState } from 'react';
import { addCaptain, loadCaptains, removeCaptain, type RosterMember } from '../../lib/teamCaptains';

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
      const { byEquipe, roster: members } = await loadCaptains(clubId, [equipeId]);
      setCaptainIds(byEquipe[equipeId] ?? []);
      setRoster(members);
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
    try {
      await addCaptain(clubId, equipeId, selected);
      setSelected('');
      load();
    } catch {
      setError('Impossible d’ajouter ce capitaine.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (userId: string) => {
    setBusy(true);
    setError('');
    try {
      await removeCaptain(clubId, equipeId, userId);
      load();
    } catch {
      setError('Impossible de retirer ce capitaine.');
    } finally {
      setBusy(false);
    }
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
