import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type {
  TeamCategorie,
  TeamCompetition,
  TeamCompetitionNom,
  TeamFormat,
  TeamGenre,
  TeamSaison,
  TeamType,
} from '../types';
import TeamMatchesHeader from '../components/teamMatches/TeamMatchesHeader';
import {
  CATEGORIE_LABELS,
  CATEGORIES_BY_TYPE,
  COMPETITION_NOMS,
  FORMAT_LABELS,
  GENRE_LABELS,
  GENRES_BY_TYPE,
  TYPE_LABELS,
} from '../components/teamMatches/teamMatchLabels';

const FORMATS: TeamFormat[] = ['2S1D', '3S1D2', '4S1D2', '4S2D'];

export default function TeamMatchesAdminPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [saisons, setSaisons] = useState<TeamSaison[]>([]);
  const [competitions, setCompetitions] = useState<TeamCompetition[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  const [selectedSaisonId, setSelectedSaisonId] = useState<string>('');

  // Ouverture directe du formulaire de compétition via ?new=competition
  // (déclenché depuis le bouton « Créer une compétition » de TeamMatchesPage).
  const autoOpenCompetition = searchParams.get('new') === 'competition';
  const clearAutoOpen = () => {
    if (!autoOpenCompetition) return;
    searchParams.delete('new');
    setSearchParams(searchParams, { replace: true });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      supabase.from('team_saisons').select('*').order('created_at', { ascending: false }),
      supabase.from('team_competitions').select('*').order('created_at', { ascending: true }),
    ]).then(([s, c]) => {
      if (cancelled) return;
      if (s.data) setSaisons(s.data as TeamSaison[]);
      if (c.data) setCompetitions(c.data as TeamCompetition[]);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Sélection par défaut : saison active, sinon la première.
  useEffect(() => {
    if (selectedSaisonId && saisons.some((s) => s.id === selectedSaisonId)) return;
    const active = saisons.find((s) => s.actif) ?? saisons[0];
    if (active) setSelectedSaisonId(active.id);
  }, [saisons, selectedSaisonId]);

  const competitionsOfSaison = useMemo(
    () => competitions.filter((c) => c.saison_id === selectedSaisonId),
    [competitions, selectedSaisonId]
  );

  return (
    <div className="min-h-screen">
      <TeamMatchesHeader
        title="Admin — Matches par équipe"
        subtitle="Gérer les saisons et les compétitions du club."
        backTo="/team-matches"
        backLabel="Matches par équipe"
      />

      <main className="container mx-auto max-w-5xl px-4 py-8 space-y-12">
        {loading ? (
          <div className="text-center text-muted-foreground py-12">Chargement...</div>
        ) : (
          <>
            <SaisonsSection saisons={saisons} competitions={competitions} onChange={reload} />
            <CompetitionsSection
              saisons={saisons}
              selectedSaisonId={selectedSaisonId}
              onSelectSaison={setSelectedSaisonId}
              competitions={competitionsOfSaison}
              onChange={reload}
              autoOpen={autoOpenCompetition && saisons.length > 0}
              onAutoOpened={clearAutoOpen}
            />
          </>
        )}
      </main>
    </div>
  );
}

// ============================================================
// Saisons
// ============================================================

function SaisonsSection({
  saisons,
  competitions,
  onChange,
}: {
  saisons: TeamSaison[];
  competitions: TeamCompetition[];
  onChange: () => void;
}) {
  const [newLabel, setNewLabel] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setError(null);
    if (!newLabel.trim()) {
      setError('Le label de la saison est obligatoire.');
      return;
    }
    const { error: err } = await supabase.from('team_saisons').insert({ label: newLabel.trim() });
    if (err) return setError(err.message);
    setNewLabel('');
    onChange();
  };

  const handleSaveEdit = async (id: string) => {
    if (!editLabel.trim()) return;
    const { error: err } = await supabase
      .from('team_saisons')
      .update({ label: editLabel.trim() })
      .eq('id', id);
    if (err) return setError(err.message);
    setEditingId(null);
    onChange();
  };

  const handleToggleActive = async (saison: TeamSaison) => {
    setError(null);
    if (saison.actif) {
      const { error: err } = await supabase
        .from('team_saisons')
        .update({ actif: false })
        .eq('id', saison.id);
      if (err) return setError(err.message);
    } else {
      // Désactive toutes les autres puis active celle-ci.
      const off = await supabase.from('team_saisons').update({ actif: false }).neq('id', saison.id);
      if (off.error) return setError(off.error.message);
      const on = await supabase.from('team_saisons').update({ actif: true }).eq('id', saison.id);
      if (on.error) return setError(on.error.message);
    }
    onChange();
  };

  const handleDelete = async (saison: TeamSaison) => {
    setError(null);
    const linked = competitions.some((c) => c.saison_id === saison.id);
    if (linked) {
      setError(`Impossible de supprimer "${saison.label}" : des compétitions y sont rattachées.`);
      return;
    }
    if (!window.confirm(`Supprimer la saison "${saison.label}" ?`)) return;
    const { error: err } = await supabase.from('team_saisons').delete().eq('id', saison.id);
    if (err) return setError(err.message);
    onChange();
  };

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-primary mb-4">Saisons</h2>

      <div className="mb-4 flex gap-2">
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="ex. 2025/2026"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          onClick={handleCreate}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95"
        >
          Ajouter
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {saisons.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
          Aucune saison. Créez-en une pour commencer.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border bg-card/90">
          {saisons.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              {editingId === s.id ? (
                <input
                  type="text"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                  autoFocus
                />
              ) : (
                <span className="flex-1 font-medium">{s.label}</span>
              )}

              {s.actif && (
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                  Active
                </span>
              )}

              <button
                onClick={() => handleToggleActive(s)}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted"
              >
                {s.actif ? 'Désactiver' : 'Activer'}
              </button>

              {editingId === s.id ? (
                <button
                  onClick={() => handleSaveEdit(s.id)}
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100"
                >
                  Enregistrer
                </button>
              ) : (
                <button
                  onClick={() => {
                    setEditingId(s.id);
                    setEditLabel(s.label);
                  }}
                  className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted"
                >
                  Modifier
                </button>
              )}

              <button
                onClick={() => handleDelete(s)}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100"
              >
                Supprimer
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ============================================================
// Compétitions
// ============================================================

interface CompetitionDraft {
  nom: TeamCompetitionNom;
  type: TeamType;
  genre: TeamGenre;
  categorie: TeamCategorie;
  format: TeamFormat;
}

function emptyDraft(): CompetitionDraft {
  return { nom: 'Pyrénées Interclubs', type: 'adultes', genre: 'hommes', categorie: 'seniors', format: '3S1D2' };
}

function CompetitionsSection({
  saisons,
  selectedSaisonId,
  onSelectSaison,
  competitions,
  onChange,
  autoOpen = false,
  onAutoOpened,
}: {
  saisons: TeamSaison[];
  selectedSaisonId: string;
  onSelectSaison: (id: string) => void;
  competitions: TeamCompetition[];
  onChange: () => void;
  autoOpen?: boolean;
  onAutoOpened?: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CompetitionDraft>(emptyDraft());
  const [error, setError] = useState<string | null>(null);

  const openCreate = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setError(null);
    setShowForm(true);
  };

  // Ouverture automatique du formulaire à l'arrivée via ?new=competition.
  useEffect(() => {
    if (autoOpen) {
      openCreate();
      onAutoOpened?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  const openEdit = (c: TeamCompetition) => {
    setEditingId(c.id);
    setDraft({ nom: c.nom, type: c.type, genre: c.genre, categorie: c.categorie, format: c.format });
    setError(null);
    setShowForm(true);
  };

  // Réaligne genre/catégorie quand le type change.
  const setType = (type: TeamType) => {
    setDraft((d) => ({
      ...d,
      type,
      genre: GENRES_BY_TYPE[type].includes(d.genre) ? d.genre : GENRES_BY_TYPE[type][0],
      categorie: CATEGORIES_BY_TYPE[type].includes(d.categorie) ? d.categorie : CATEGORIES_BY_TYPE[type][0],
    }));
  };

  const handleSubmit = async () => {
    setError(null);
    if (!selectedSaisonId) {
      setError('Sélectionnez une saison.');
      return;
    }
    const payload = { saison_id: selectedSaisonId, ...draft };
    const { error: err } = editingId
      ? await supabase.from('team_competitions').update(payload).eq('id', editingId)
      : await supabase.from('team_competitions').insert(payload);
    if (err) return setError(err.message);
    setShowForm(false);
    onChange();
  };

  const handleDelete = async (c: TeamCompetition) => {
    setError(null);
    const { count, error: countErr } = await supabase
      .from('team_equipes')
      .select('id', { count: 'exact', head: true })
      .eq('competition_id', c.id);
    if (countErr) return setError(countErr.message);
    if ((count ?? 0) > 0) {
      setError('Impossible de supprimer : des équipes sont rattachées à cette compétition.');
      return;
    }
    if (!window.confirm('Supprimer cette compétition ?')) return;
    const { error: err } = await supabase.from('team_competitions').delete().eq('id', c.id);
    if (err) return setError(err.message);
    onChange();
  };

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">Compétitions</h2>
        <div className="flex items-center gap-3">
          <select
            value={selectedSaisonId}
            onChange={(e) => onSelectSaison(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {saisons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.actif ? ' (active)' : ''}
              </option>
            ))}
          </select>
          <button
            onClick={openCreate}
            disabled={!selectedSaisonId}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-50"
          >
            + Compétition
          </button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {competitions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
          Aucune compétition pour cette saison.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card/90">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Nom</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Genre</th>
                <th className="px-4 py-2.5">Catégorie</th>
                <th className="px-4 py-2.5">Format</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {competitions.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5 font-medium">{c.nom}</td>
                  <td className="px-4 py-2.5">{TYPE_LABELS[c.type]}</td>
                  <td className="px-4 py-2.5">{GENRE_LABELS[c.genre]}</td>
                  <td className="px-4 py-2.5">{CATEGORIE_LABELS[c.categorie]}</td>
                  <td className="px-4 py-2.5">{FORMAT_LABELS[c.format]}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEdit(c)}
                        className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted"
                      >
                        Modifier
                      </button>
                      <button
                        onClick={() => handleDelete(c)}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100"
                      >
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold">
              {editingId ? 'Modifier la compétition' : 'Nouvelle compétition'}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground">Nom</label>
                <select
                  value={draft.nom}
                  onChange={(e) => setDraft((d) => ({ ...d, nom: e.target.value as TeamCompetitionNom }))}
                  className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  {COMPETITION_NOMS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground">Type</label>
                <div className="mt-1 inline-flex rounded-lg border border-border p-0.5">
                  {(['adultes', 'jeunes'] as TeamType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setType(t)}
                      className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                        draft.type === t
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground">Genre</label>
                  <select
                    value={draft.genre}
                    onChange={(e) => setDraft((d) => ({ ...d, genre: e.target.value as TeamGenre }))}
                    className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    {GENRES_BY_TYPE[draft.type].map((g) => (
                      <option key={g} value={g}>
                        {GENRE_LABELS[g]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground">Catégorie</label>
                  <select
                    value={draft.categorie}
                    onChange={(e) => setDraft((d) => ({ ...d, categorie: e.target.value as TeamCategorie }))}
                    className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    {CATEGORIES_BY_TYPE[draft.type].map((cat) => (
                      <option key={cat} value={cat}>
                        {CATEGORIE_LABELS[cat]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground">Format</label>
                <select
                  value={draft.format}
                  onChange={(e) => setDraft((d) => ({ ...d, format: e.target.value as TeamFormat }))}
                  className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  {FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {FORMAT_LABELS[f]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
              >
                Annuler
              </button>
              <button
                onClick={handleSubmit}
                className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95"
              >
                {editingId ? 'Enregistrer' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
