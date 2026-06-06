import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type {
  TeamCompetition,
  TeamEquipe,
  TeamEtape,
  TeamRencontre,
  TeamSaison,
  TeamStadeFinale,
} from '../types';
import TeamMatchesHeader from '../components/teamMatches/TeamMatchesHeader';
import {
  STADES_FINALE,
  STADE_LABELS,
  competitionLabel,
  stadesFromDepart,
} from '../components/teamMatches/teamMatchLabels';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function TeamEquipePage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [equipe, setEquipe] = useState<TeamEquipe | null>(null);
  const [competition, setCompetition] = useState<TeamCompetition | null>(null);
  const [saison, setSaison] = useState<TeamSaison | null>(null);
  const [etapes, setEtapes] = useState<TeamEtape[]>([]);
  const [rencontres, setRencontres] = useState<TeamRencontre[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showQualif, setShowQualif] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);

    const { data: eq } = await supabase.from('team_equipes').select('*').eq('id', id).single();
    if (!eq) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const equipeRow = eq as TeamEquipe;
    setEquipe(equipeRow);

    const { data: comp } = await supabase
      .from('team_competitions')
      .select('*')
      .eq('id', equipeRow.competition_id)
      .single();
    const compRow = (comp ?? null) as TeamCompetition | null;
    setCompetition(compRow);

    if (compRow) {
      const { data: sai } = await supabase
        .from('team_saisons')
        .select('*')
        .eq('id', compRow.saison_id)
        .single();
      setSaison((sai ?? null) as TeamSaison | null);
    }

    const { data: etapeData } = await supabase
      .from('team_etapes')
      .select('*')
      .eq('equipe_id', equipeRow.id);
    const etapeRows = (etapeData ?? []) as TeamEtape[];
    setEtapes(etapeRows);

    const etapeIds = etapeRows.map((e) => e.id);
    const { data: rencData } = etapeIds.length
      ? await supabase.from('team_rencontres').select('*').in('etape_id', etapeIds)
      : { data: [] };
    setRencontres((rencData ?? []) as TeamRencontre[]);

    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const rencontreByEtape = useMemo(
    () => Object.fromEntries(rencontres.map((r) => [r.etape_id, r])) as Record<string, TeamRencontre>,
    [rencontres]
  );

  const pouleEtapes = useMemo(
    () =>
      etapes
        .filter((e) => e.phase === 'poule')
        .sort((a, b) => (a.numero_journee ?? 0) - (b.numero_journee ?? 0)),
    [etapes]
  );

  const finaleEtapes = useMemo(
    () =>
      etapes
        .filter((e) => e.phase === 'finale')
        .sort(
          (a, b) =>
            STADES_FINALE.indexOf(a.stade_finale as TeamStadeFinale) -
            STADES_FINALE.indexOf(b.stade_finale as TeamStadeFinale)
        ),
    [etapes]
  );

  const allPouleHaveRencontre =
    pouleEtapes.length > 0 && pouleEtapes.every((e) => rencontreByEtape[e.id]);

  const canQualify = Boolean(equipe && equipe.qualifiee === null && allPouleHaveRencontre);

  const handleDeleteJournee = async (etape: TeamEtape) => {
    if (!equipe) return;
    if (pouleEtapes.length <= 1) {
      alert('Une équipe doit conserver au moins une journée de poule.');
      return;
    }
    if (!window.confirm(`Supprimer la journée J${etape.numero_journee} ?`)) return;

    const { error } = await supabase.from('team_etapes').delete().eq('id', etape.id);
    if (error) {
      alert(`Erreur suppression : ${error.message}`);
      return;
    }

    // Renumérote les journées restantes (1..M) et ajuste le nombre de journées.
    const remaining = pouleEtapes.filter((e) => e.id !== etape.id);
    await Promise.all(
      remaining
        .map((e, i) =>
          e.numero_journee === i + 1
            ? null
            : supabase.from('team_etapes').update({ numero_journee: i + 1 }).eq('id', e.id)
        )
        .filter((p): p is NonNullable<typeof p> => p !== null)
    );
    await supabase
      .from('team_equipes')
      .update({ nb_journees_poule: remaining.length })
      .eq('id', equipe.id);

    load();
  };

  const handleDeleteRencontre = async (rencontre: TeamRencontre) => {
    if (
      !window.confirm(
        `Supprimer la rencontre contre ${rencontre.club_adverse} ? Les matches saisis seront aussi supprimés.`
      )
    )
      return;
    const { error } = await supabase.from('team_rencontres').delete().eq('id', rencontre.id);
    if (error) {
      alert(`Erreur suppression : ${error.message}`);
      return;
    }
    load();
  };

  const statusBadge = useMemo(() => {
    if (!equipe) return null;
    if (equipe.qualifiee === false) return { label: 'Éliminée', cls: 'bg-red-100 text-red-700' };
    if (equipe.qualifiee === true)
      return { label: 'Phase finale', cls: 'bg-amber-100 text-amber-800' };
    const done = pouleEtapes.filter((e) => rencontreByEtape[e.id]).length;
    return {
      label: `En poule — J${done}/${equipe.nb_journees_poule}`,
      cls: 'bg-gray-100 text-gray-700',
    };
  }, [equipe, pouleEtapes, rencontreByEtape]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Chargement...
      </div>
    );
  }

  if (notFound || !equipe || !competition || !saison) {
    return (
      <div className="min-h-screen">
        <TeamMatchesHeader title="Équipe introuvable" backTo="/team-matches" backLabel="Matches par équipe" />
        <main className="container mx-auto px-4 py-12 text-center text-muted-foreground">
          Cette équipe n'existe pas ou a été supprimée.
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <TeamMatchesHeader
        title={competitionLabel(competition)}
        backTo="/team-matches"
        backLabel="Matches par équipe"
      />

      <main className="container mx-auto max-w-4xl px-4 py-8 space-y-10">
        {/* En-tête équipe */}
        <div className="rounded-2xl border bg-card/90 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">Saison {saison.label}</p>
              <h2 className="mt-1 text-2xl font-semibold">
                Équipe {equipe.numero} — Division {equipe.division}
              </h2>
            </div>
            {statusBadge && (
              <span className={`rounded-full px-3 py-1 text-sm font-medium ${statusBadge.cls}`}>
                {statusBadge.label}
              </span>
            )}
          </div>
        </div>

        {/* Phase de poule */}
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
              Phase de poule
            </h2>
            {canQualify && (
              <button
                onClick={() => setShowQualif(true)}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95"
              >
                Qualifier pour les phases finales
              </button>
            )}
          </div>

          <div className="divide-y divide-border rounded-xl border bg-card/90">
            {pouleEtapes.map((etape) => (
              <EtapeRow
                key={etape.id}
                titre={`J${etape.numero_journee}`}
                rencontre={rencontreByEtape[etape.id]}
                onCreate={() =>
                  navigate(`/team-matches/rencontre/new?etapeId=${etape.id}`)
                }
                onOpen={(rid) => navigate(`/team-matches/rencontre/${rid}`)}
                onDelete={handleDeleteRencontre}
                onDeleteEtape={() => handleDeleteJournee(etape)}
              />
            ))}
          </div>
        </section>

        {/* Phase finale */}
        {equipe.qualifiee === true && (
          <section>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.08em] text-primary">
              Phase finale
            </h2>
            <div className="divide-y divide-border rounded-xl border bg-card/90">
              {finaleEtapes.map((etape) => (
                <EtapeRow
                  key={etape.id}
                  titre={STADE_LABELS[etape.stade_finale as TeamStadeFinale]}
                  rencontre={rencontreByEtape[etape.id]}
                  onCreate={() => navigate(`/team-matches/rencontre/new?etapeId=${etape.id}`)}
                  onOpen={(rid) => navigate(`/team-matches/rencontre/${rid}`)}
                  onDelete={handleDeleteRencontre}
                />
              ))}
            </div>
          </section>
        )}
      </main>

      {showQualif && (
        <QualifModal
          equipe={equipe}
          onClose={() => setShowQualif(false)}
          onDone={() => {
            setShowQualif(false);
            load();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Ligne d'étape (journée ou stade)
// ============================================================

function EtapeRow({
  titre,
  rencontre,
  onCreate,
  onOpen,
  onDelete,
  onDeleteEtape,
}: {
  titre: string;
  rencontre: TeamRencontre | undefined;
  onCreate: () => void;
  onOpen: (rencontreId: string) => void;
  onDelete: (rencontre: TeamRencontre) => void;
  onDeleteEtape?: () => void;
}) {
  if (!rencontre) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="font-medium text-muted-foreground">{titre}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={onCreate}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted"
          >
            + Créer la rencontre
          </button>
          {onDeleteEtape && (
            <button
              onClick={onDeleteEtape}
              title="Supprimer cette journée"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100"
            >
              Supprimer
            </button>
          )}
        </div>
      </div>
    );
  }

  const hasScore = rencontre.score_club !== null && rencontre.score_adverse !== null;

  return (
    <div className="flex items-center gap-2 pr-2 transition hover:bg-muted/50">
      <button
        onClick={() => onOpen(rencontre.id)}
        className="flex min-w-0 flex-1 items-center gap-4 px-4 py-3 text-left"
      >
        <span className="w-16 shrink-0 font-semibold">{titre}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{rencontre.club_adverse}</p>
          <p className="text-xs text-muted-foreground">
            {formatDate(rencontre.date_heure)} · {rencontre.domicile ? 'Au club' : 'Déplacement'}
          </p>
        </div>
        {hasScore ? (
          <span className="rounded-md bg-muted px-2.5 py-1 text-sm font-semibold tabular-nums">
            {rencontre.score_club} – {rencontre.score_adverse}
          </span>
        ) : (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
            À jouer
          </span>
        )}
      </button>
      <button
        onClick={() => onDelete(rencontre)}
        title="Supprimer la rencontre"
        className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100"
      >
        Supprimer
      </button>
    </div>
  );
}

// ============================================================
// Modale de qualification
// ============================================================

function QualifModal({
  equipe,
  onClose,
  onDone,
}: {
  equipe: TeamEquipe;
  onClose: () => void;
  onDone: () => void;
}) {
  const [qualifiee, setQualifiee] = useState(true);
  const [stade, setStade] = useState<TeamStadeFinale>('1/8');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    setSaving(true);

    const { error: updErr } = await supabase
      .from('team_equipes')
      .update({
        qualifiee,
        stade_finale_depart: qualifiee ? stade : null,
      })
      .eq('id', equipe.id);

    if (updErr) {
      setError(updErr.message);
      setSaving(false);
      return;
    }

    if (qualifiee) {
      // Génère une étape par stade depuis le départ jusqu'à la finale.
      const etapes = stadesFromDepart(stade).map((s) => ({
        equipe_id: equipe.id,
        phase: 'finale' as const,
        stade_finale: s,
      }));
      const { error: insErr } = await supabase.from('team_etapes').insert(etapes);
      if (insErr) {
        setError(`Statut mis à jour mais erreur sur les stades : ${insErr.message}`);
        setSaving(false);
        return;
      }
    }

    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold">Issue de la phase de poule</h3>

        <div className="space-y-4">
          <div className="inline-flex rounded-lg border border-border p-0.5">
            <button
              type="button"
              onClick={() => setQualifiee(true)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                qualifiee ? 'bg-emerald-600 text-white' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              Qualifiée
            </button>
            <button
              type="button"
              onClick={() => setQualifiee(false)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                !qualifiee ? 'bg-red-600 text-white' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              Éliminée
            </button>
          </div>

          {qualifiee && (
            <div>
              <label className="block text-sm font-medium text-foreground">Stade de départ</label>
              <select
                value={stade}
                onChange={(e) => setStade(e.target.value as TeamStadeFinale)}
                className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                {STADES_FINALE.map((s) => (
                  <option key={s} value={s}>
                    {STADE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          )}
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
            {saving ? 'Validation...' : 'Valider'}
          </button>
        </div>
      </div>
    </div>
  );
}
