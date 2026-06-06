import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { TeamFormat, TeamMatchLine, TeamRencontre } from '../../types';
import { computeScore } from './teamMatchLabels';

interface Props {
  rencontre: TeamRencontre;
  lines: TeamMatchLine[];
  format: TeamFormat;
  onSaved: () => void;
}

export default function TeamScoreSection({ rencontre, lines, format, onSaved }: Props) {
  // Dès qu'au moins un match a un vainqueur (saisi manuellement ou via le live),
  // le score global est calculé à partir des matches plutôt que saisi à la main.
  const hasResults = lines.some((l) => l.gagnant !== null);

  const [scoreClub, setScoreClub] = useState<string>(
    rencontre.score_club !== null ? String(rencontre.score_club) : ''
  );
  const [scoreAdverse, setScoreAdverse] = useState<string>(
    rencontre.score_adverse !== null ? String(rencontre.score_adverse) : ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (club: number | null, adverse: number | null) => {
    setError(null);
    setSaving(true);
    const { error: err } = await supabase
      .from('team_rencontres')
      .update({ score_club: club, score_adverse: adverse })
      .eq('id', rencontre.id);
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    onSaved();
  };

  const handleManualSave = () => {
    const club = scoreClub === '' ? null : Number(scoreClub);
    const adverse = scoreAdverse === '' ? null : Number(scoreAdverse);
    save(club, adverse);
  };

  const handleRecompute = () => {
    const { club, adverse } = computeScore(lines, format);
    save(club, adverse);
  };

  if (hasResults) {
    const computed = computeScore(lines, format);
    return (
      <section className="rounded-2xl border bg-card/90 p-6 shadow-sm">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.08em] text-primary">
          Score final
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Calculé automatiquement à partir des vainqueurs des matches saisis.
        </p>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Notre score</p>
            <p className="text-3xl font-bold tabular-nums">
              {rencontre.score_club ?? computed.club}
            </p>
          </div>
          <span className="text-2xl text-muted-foreground">–</span>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Adverse</p>
            <p className="text-3xl font-bold tabular-nums">
              {rencontre.score_adverse ?? computed.adverse}
            </p>
          </div>
          <button
            onClick={handleRecompute}
            disabled={saving}
            className="ml-auto rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted disabled:opacity-50"
          >
            {saving ? '...' : 'Recalculer'}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </section>
    );
  }

  return (
    <section className="rounded-2xl border bg-card/90 p-6 shadow-sm">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.08em] text-primary">Score final</h2>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs text-muted-foreground">Notre score</label>
          <input
            type="number"
            min={0}
            value={scoreClub}
            onChange={(e) => setScoreClub(e.target.value)}
            className="mt-1 w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <span className="pb-2 text-2xl text-muted-foreground">–</span>
        <div>
          <label className="block text-xs text-muted-foreground">Score adverse</label>
          <input
            type="number"
            min={0}
            value={scoreAdverse}
            onChange={(e) => setScoreAdverse(e.target.value)}
            className="mt-1 w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={handleManualSave}
          disabled={saving}
          className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-50"
        >
          {saving ? 'Enregistrement...' : 'Enregistrer le score'}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </section>
  );
}
