import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { TeamMatchGagnant, TeamMatchLine } from '../../types';

interface Props {
  line: TeamMatchLine;
  onClose: () => void;
  onSaved: () => void;
}

export default function TeamMatchScoreModal({ line, onClose, onSaved }: Props) {
  const [gagnant, setGagnant] = useState<TeamMatchGagnant>(line.gagnant ?? 'club');
  const [score, setScore] = useState(line.score ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persist = async (payload: { gagnant: TeamMatchGagnant | null; score: string | null }) => {
    setError(null);
    setSaving(true);
    const { error: err } = await supabase
      .from('team_match_lines')
      .update(payload)
      .eq('id', line.id);
    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }
    onSaved();
  };

  const handleSubmit = () => persist({ gagnant, score: score.trim() || null });
  const handleClear = () => persist({ gagnant: null, score: null });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold">Saisir le score</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground">Vainqueur</label>
            <div className="mt-1 inline-flex rounded-lg border border-border p-0.5">
              {(
                [
                  { val: 'club', label: 'Notre club' },
                  { val: 'adverse', label: 'Adverse' },
                ] as { val: TeamMatchGagnant; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => setGagnant(opt.val)}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                    gagnant === opt.val
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground">
              Score <span className="text-muted-foreground">(optionnel)</span>
            </label>
            <input
              type="text"
              value={score}
              onChange={(e) => setScore(e.target.value)}
              placeholder="ex. 6-4 6-2"
              className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex items-center justify-end gap-3">
          {line.gagnant && (
            <button
              onClick={handleClear}
              disabled={saving}
              className="mr-auto rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
            >
              Retirer le résultat
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-50"
          >
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}
