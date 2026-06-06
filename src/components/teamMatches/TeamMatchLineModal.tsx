import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { TeamJoueur, TeamMatchLine, TeamMatchLineType } from '../../types';

interface Props {
  rencontreId: string;
  clubAdverse: string;
  defaultOrdre: number;
  line?: TeamMatchLine; // présent en édition
  onClose: () => void;
  onSaved: () => void;
}

function emptyJoueur(): TeamJoueur {
  return { prenom: '', nom: '', classement: '' };
}

/** Ajuste un tableau de joueurs à la taille voulue (1 pour simple, 2 pour double). */
function resize(joueurs: TeamJoueur[], n: number): TeamJoueur[] {
  const next = joueurs.slice(0, n);
  while (next.length < n) next.push(emptyJoueur());
  return next;
}

export default function TeamMatchLineModal({
  rencontreId,
  clubAdverse,
  defaultOrdre,
  line,
  onClose,
  onSaved,
}: Props) {
  const [matchType, setMatchType] = useState<TeamMatchLineType>(line?.match_type ?? 'simple');
  const [club, setClub] = useState<TeamJoueur[]>(
    resize(line?.joueurs_club ?? [], line?.match_type === 'double' ? 2 : 1)
  );
  const [adverse, setAdverse] = useState<TeamJoueur[]>(
    resize(line?.joueurs_adverse ?? [], line?.match_type === 'double' ? 2 : 1)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeType = (t: TeamMatchLineType) => {
    const n = t === 'double' ? 2 : 1;
    setMatchType(t);
    setClub((prev) => resize(prev, n));
    setAdverse((prev) => resize(prev, n));
  };

  const updateJoueur = (
    side: 'club' | 'adverse',
    index: number,
    field: keyof TeamJoueur,
    value: string
  ) => {
    const setter = side === 'club' ? setClub : setAdverse;
    setter((prev) => prev.map((j, i) => (i === index ? { ...j, [field]: value } : j)));
  };

  const validate = (): boolean => {
    const all = [...club, ...adverse];
    for (const j of all) {
      if (!j.prenom.trim()) {
        setError('Le prénom est obligatoire pour chaque joueur.');
        return false;
      }
      if (!j.classement.trim()) {
        setError('Le classement est obligatoire pour chaque joueur.');
        return false;
      }
    }
    return true;
  };

  const normalize = (joueurs: TeamJoueur[]): TeamJoueur[] =>
    joueurs.map((j) => ({
      prenom: j.prenom.trim(),
      nom: j.nom?.trim() ? j.nom.trim() : null,
      classement: j.classement.trim(),
    }));

  const handleSubmit = async () => {
    setError(null);
    if (!validate()) return;
    setSaving(true);

    const payload = {
      rencontre_id: rencontreId,
      match_type: matchType,
      joueurs_club: normalize(club),
      joueurs_adverse: normalize(adverse),
    };

    const { error: err } = line
      ? await supabase.from('team_match_lines').update(payload).eq('id', line.id)
      : await supabase.from('team_match_lines').insert({ ...payload, ordre: defaultOrdre });

    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border bg-card p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold">{line ? 'Modifier le match' : 'Ajouter un match'}</h3>

        {/* Type */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-foreground">Type</label>
          <div className="mt-1 inline-flex rounded-lg border border-border p-0.5">
            {(['simple', 'double'] as TeamMatchLineType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => changeType(t)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize transition ${
                  matchType === t
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* Joueurs du club */}
          <fieldset className="space-y-3 rounded-xl border border-border bg-background/60 p-4">
            <legend className="px-2 text-sm font-semibold">Joueurs du club</legend>
            {club.map((j, i) => (
              <JoueurFields
                key={i}
                joueur={j}
                onChange={(field, value) => updateJoueur('club', i, field, value)}
              />
            ))}
          </fieldset>

          {/* Joueurs adverses */}
          <fieldset className="space-y-3 rounded-xl border border-border bg-background/60 p-4">
            <legend className="px-2 text-sm font-semibold">Joueurs adverses</legend>
            <p className="px-1 text-xs text-muted-foreground">Club : {clubAdverse}</p>
            {adverse.map((j, i) => (
              <JoueurFields
                key={i}
                joueur={j}
                onChange={(field, value) => updateJoueur('adverse', i, field, value)}
              />
            ))}
          </fieldset>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
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

function JoueurFields({
  joueur,
  onChange,
}: {
  joueur: TeamJoueur;
  onChange: (field: keyof TeamJoueur, value: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <input
        type="text"
        value={joueur.prenom}
        onChange={(e) => onChange('prenom', e.target.value)}
        placeholder="Prénom *"
        className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
      />
      <input
        type="text"
        value={joueur.nom ?? ''}
        onChange={(e) => onChange('nom', e.target.value)}
        placeholder="Nom"
        className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
      />
      <input
        type="text"
        value={joueur.classement}
        onChange={(e) => onChange('classement', e.target.value)}
        placeholder="Class. *"
        className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
      />
    </div>
  );
}
