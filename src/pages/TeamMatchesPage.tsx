import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toJpeg } from 'html-to-image';
import { supabase } from '../lib/supabase';
import type {
  TeamCompetition,
  TeamDivision,
  TeamEquipe,
  TeamEtape,
  TeamMatch,
  TeamMatchGender,
  TeamMatchType,
  TeamRencontre,
  TeamSaison,
} from '../types';
import TeamMatchesHeader from '../components/teamMatches/TeamMatchesHeader';
import TeamEquipeCard, { type EquipeBadge } from '../components/teamMatches/TeamEquipeCard';
import TeamMatchImagePreview from '../components/TeamMatchImagePreview';
import { DIVISIONS, competitionLabel } from '../components/teamMatches/teamMatchLabels';

/** Étapes de poule + ids des étapes ayant une rencontre — pour calculer les badges. */
interface ProgressData {
  pouleByEquipe: Record<string, TeamEtape[]>;
  finaleByEquipe: Record<string, TeamEtape[]>;
  etapesWithRencontre: Set<string>;
}

function computeBadge(equipe: TeamEquipe, progress: ProgressData): EquipeBadge {
  if (equipe.qualifiee === false) return { label: 'Éliminée', tone: 'danger' };

  if (equipe.qualifiee === true) {
    const finales = progress.finaleByEquipe[equipe.id] ?? [];
    const played = finales.filter((e) => progress.etapesWithRencontre.has(e.id));
    const last = played[played.length - 1];
    return {
      label: last?.stade_finale ? `Phase finale — ${last.stade_finale}` : 'Phase finale',
      tone: 'final',
    };
  }

  // En poule
  const poule = progress.pouleByEquipe[equipe.id] ?? [];
  const done = poule.filter((e) => progress.etapesWithRencontre.has(e.id)).length;
  return { label: `Poule J${done}/${equipe.nb_journees_poule}`, tone: 'neutral' };
}

export default function TeamMatchesPage() {
  const navigate = useNavigate();
  const [saisons, setSaisons] = useState<TeamSaison[]>([]);
  const [competitions, setCompetitions] = useState<TeamCompetition[]>([]);
  const [equipes, setEquipes] = useState<TeamEquipe[]>([]);
  const [progress, setProgress] = useState<ProgressData>({
    pouleByEquipe: {},
    finaleByEquipe: {},
    etapesWithRencontre: new Set(),
  });
  const [loading, setLoading] = useState(true);
  const [refReady, setRefReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  const [saisonId, setSaisonId] = useState('');
  const [competitionId, setCompetitionId] = useState(''); // '' = toutes
  const [showForm, setShowForm] = useState(false);
  const [showPoster, setShowPoster] = useState(false);

  // Référentiel saisons + compétitions.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.from('team_saisons').select('*').order('created_at', { ascending: false }),
      supabase.from('team_competitions').select('*').order('created_at', { ascending: true }),
    ]).then(([s, c]) => {
      if (cancelled) return;
      const err = s.error ?? c.error;
      if (err) setLoadError(err.message);
      if (s.data) setSaisons(s.data as TeamSaison[]);
      if (c.data) setCompetitions(c.data as TeamCompetition[]);
      setRefReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Sélection saison par défaut : active.
  useEffect(() => {
    if (saisonId && saisons.some((s) => s.id === saisonId)) return;
    const active = saisons.find((s) => s.actif) ?? saisons[0];
    if (active) setSaisonId(active.id);
  }, [saisons, saisonId]);

  const competitionsOfSaison = useMemo(
    () => competitions.filter((c) => c.saison_id === saisonId),
    [competitions, saisonId]
  );

  // Équipes de la saison/compétition sélectionnée + données de progression.
  useEffect(() => {
    if (!refReady) return; // attend le chargement du référentiel
    if (!saisonId) {
      // Aucune saison (tables vides) → on sort de l'état "chargement".
      setEquipes([]);
      setProgress({ pouleByEquipe: {}, finaleByEquipe: {}, etapesWithRencontre: new Set() });
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    const compIds = competitionsOfSaison.map((c) => c.id);
    const filteredCompIds = competitionId ? [competitionId] : compIds;

    if (filteredCompIds.length === 0) {
      setEquipes([]);
      setProgress({ pouleByEquipe: {}, finaleByEquipe: {}, etapesWithRencontre: new Set() });
      setLoading(false);
      return;
    }

    supabase
      .from('team_equipes')
      .select('*')
      .in('competition_id', filteredCompIds)
      .order('numero', { ascending: true })
      .then(async ({ data: eqData }) => {
        if (cancelled) return;
        const eqs = (eqData ?? []) as TeamEquipe[];
        setEquipes(eqs);

        const equipeIds = eqs.map((e) => e.id);
        if (equipeIds.length === 0) {
          setProgress({ pouleByEquipe: {}, finaleByEquipe: {}, etapesWithRencontre: new Set() });
          setLoading(false);
          return;
        }

        const { data: etapeData } = await supabase
          .from('team_etapes')
          .select('*')
          .in('equipe_id', equipeIds);
        const etapes = (etapeData ?? []) as TeamEtape[];

        const etapeIds = etapes.map((e) => e.id);
        const { data: rencData } = etapeIds.length
          ? await supabase.from('team_rencontres').select('etape_id').in('etape_id', etapeIds)
          : { data: [] };

        if (cancelled) return;

        const pouleByEquipe: Record<string, TeamEtape[]> = {};
        const finaleByEquipe: Record<string, TeamEtape[]> = {};
        for (const e of etapes) {
          const bucket = e.phase === 'poule' ? pouleByEquipe : finaleByEquipe;
          (bucket[e.equipe_id] ??= []).push(e);
        }
        for (const list of Object.values(pouleByEquipe)) {
          list.sort((a, b) => (a.numero_journee ?? 0) - (b.numero_journee ?? 0));
        }
        const etapesWithRencontre = new Set<string>(
          ((rencData ?? []) as { etape_id: string }[]).map((r) => r.etape_id)
        );

        setProgress({ pouleByEquipe, finaleByEquipe, etapesWithRencontre });
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refReady, saisonId, competitionId, competitionsOfSaison, reloadKey]);

  const saisonsById = useMemo(() => Object.fromEntries(saisons.map((s) => [s.id, s])), [saisons]);
  const competitionsById = useMemo(
    () => Object.fromEntries(competitions.map((c) => [c.id, c])),
    [competitions]
  );

  const handleDelete = async (equipe: TeamEquipe) => {
    if (!window.confirm(`Supprimer l'équipe ${equipe.numero} et toutes ses rencontres ?`)) return;
    const { error } = await supabase.from('team_equipes').delete().eq('id', equipe.id);
    if (error) {
      alert(`Erreur suppression : ${error.message}`);
      return;
    }
    reload();
  };

  return (
    <div className="min-h-screen">
      <TeamMatchesHeader
        title="Matches par équipe"
        subtitle="Gérer les rencontres interclubs de l'équipe."
        backTo="/"
        backLabel="Accueil"
        actions={
          <Link
            to="/team-matches/admin"
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
          >
            Admin
          </Link>
        }
      />

      <main className="container mx-auto px-4 py-8">
        {loadError && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Erreur de chargement : {loadError}
            <span className="mt-1 block text-xs">
              Vérifiez que la migration <code>20260606_team_matches.sql</code> a bien été appliquée
              sur Supabase.
            </span>
          </div>
        )}

        {/* Filtres */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <select
            value={saisonId}
            onChange={(e) => {
              setSaisonId(e.target.value);
              setCompetitionId('');
            }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {saisons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.actif ? ' (active)' : ''}
              </option>
            ))}
          </select>

          <select
            value={competitionId}
            onChange={(e) => setCompetitionId(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">Toutes les compétitions</option>
            {competitionsOfSaison.map((c) => (
              <option key={c.id} value={c.id}>
                {competitionLabel(c)}
              </option>
            ))}
          </select>

          <div className="ml-auto flex flex-wrap gap-3">
            <button
              onClick={() => setShowPoster(true)}
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95"
            >
              Générer une affiche
            </button>
            <button
              onClick={() => navigate('/team-matches/admin?new=competition')}
              className="rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground shadow-sm transition hover:bg-muted"
            >
              Créer une compétition
            </button>
            <button
              onClick={() => setShowForm(true)}
              disabled={competitionsOfSaison.length === 0}
              title={
                competitionsOfSaison.length === 0
                  ? 'Créez d\'abord une compétition dans cette saison'
                  : undefined
              }
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-50"
            >
              Créer une équipe
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center text-muted-foreground py-12">Chargement...</div>
        ) : saisons.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center text-muted-foreground">
            Aucune saison. Rendez-vous dans l'Admin pour en créer une.
          </div>
        ) : equipes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center text-muted-foreground">
            Aucune équipe pour cette sélection.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {equipes.map((eq) => {
              const competition = competitionsById[eq.competition_id];
              const saison = competition ? saisonsById[competition.saison_id] : undefined;
              if (!competition || !saison) return null;
              return (
                <TeamEquipeCard
                  key={eq.id}
                  equipe={eq}
                  competition={competition}
                  saison={saison}
                  badge={computeBadge(eq, progress)}
                  onDelete={() => handleDelete(eq)}
                />
              );
            })}
          </div>
        )}
      </main>

      {showForm && (
        <CreateEquipeForm
          competitions={competitionsOfSaison}
          existingEquipes={equipes}
          defaultCompetitionId={competitionId || competitionsOfSaison[0]?.id || ''}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            reload();
          }}
        />
      )}

      {showPoster && <GeneratePosterModal onClose={() => setShowPoster(false)} />}
    </div>
  );
}

// ============================================================
// Formulaire de création d'équipe
// ============================================================

function CreateEquipeForm({
  competitions,
  existingEquipes,
  defaultCompetitionId,
  onClose,
  onCreated,
}: {
  competitions: TeamCompetition[];
  existingEquipes: TeamEquipe[];
  defaultCompetitionId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [competitionId, setCompetitionId] = useState(defaultCompetitionId);
  const [division, setDivision] = useState<TeamDivision>('R2');
  const [nbJournees, setNbJournees] = useState(5);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Numéro auto = plus grand numéro existant dans la compétition + 1.
  const numero = useMemo(() => {
    const nums = existingEquipes
      .filter((e) => e.competition_id === competitionId)
      .map((e) => e.numero);
    return nums.length ? Math.max(...nums) + 1 : 1;
  }, [existingEquipes, competitionId]);

  const handleSubmit = async () => {
    setError(null);
    if (!competitionId) {
      setError('Sélectionnez une compétition.');
      return;
    }
    if (!Number.isInteger(nbJournees) || nbJournees < 1) {
      setError('Le nombre de journées doit être un entier ≥ 1.');
      return;
    }
    setSaving(true);

    const { data, error: insertErr } = await supabase
      .from('team_equipes')
      .insert({
        competition_id: competitionId,
        numero,
        division,
        nb_journees_poule: nbJournees,
      })
      .select('id')
      .single();

    if (insertErr || !data) {
      setError(insertErr?.message ?? 'Création impossible.');
      setSaving(false);
      return;
    }

    // Génération automatique des étapes de poule J1..JN.
    const etapes = Array.from({ length: nbJournees }, (_, i) => ({
      equipe_id: data.id,
      phase: 'poule' as const,
      numero_journee: i + 1,
    }));
    const { error: etapesErr } = await supabase.from('team_etapes').insert(etapes);
    if (etapesErr) {
      setError(`Équipe créée mais erreur sur les journées : ${etapesErr.message}`);
      setSaving(false);
      return;
    }

    onCreated();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold">Créer une équipe</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground">Compétition</label>
            <select
              value={competitionId}
              onChange={(e) => setCompetitionId(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {competitionLabel(c)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground">Numéro</label>
              <input
                type="text"
                value={`Équipe ${numero}`}
                readOnly
                className="mt-1 block w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground">Division</label>
              <select
                value={division}
                onChange={(e) => setDivision(e.target.value as TeamDivision)}
                className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                {DIVISIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground">Journées de poule</label>
            <input
              type="number"
              min={1}
              value={nbJournees}
              onChange={(e) => setNbJournees(Number(e.target.value))}
              className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
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
            {saving ? 'Création...' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Génération d'affiche des rencontres à venir
// ============================================================

/** Rencontre à venir avec son contexte (étape → équipe → compétition). */
interface RencontreWithContext extends TeamRencontre {
  etape: {
    equipe: (TeamEquipe & { competition: TeamCompetition | null }) | null;
  } | null;
}

const MAX_POSTER_MATCHES = 8;

function formatRencontreDate(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  });
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${datePart}, ${d.getHours()}h${pad(d.getMinutes())}`;
}

function rencontreToTeamMatch(
  rencontre: TeamRencontre,
  equipe: TeamEquipe,
  competition: TeamCompetition,
): TeamMatch {
  const dt = new Date(rencontre.date_heure);
  const pad = (n: number) => String(n).padStart(2, '0');

  // date locale YYYY-MM-DD
  const date = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  // heure locale HH:MM
  const time = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;

  const gender: TeamMatchGender =
    competition.genre === 'femmes' || competition.genre === 'filles'
      ? 'Féminin'
      : 'Masculin';

  const matchTypeMap: Record<string, TeamMatchType> = {
    seniors: 'Seniors',
    '35_ans': 'Seniors +35',
    '60_ans': 'Seniors +35', // pas d'entrée dédiée — fallback
    '17_18': 'Jeunes 15/16 ans',
    '15_16': 'Jeunes 15/16 ans',
    '13_14': 'Jeunes 13/14 ans',
    '11_12': 'Jeunes 11/12 ans',
  };
  const matchType: TeamMatchType = matchTypeMap[competition.categorie] ?? 'Seniors';

  const teamNumber = Math.min(equipe.numero, 3) as 1 | 2 | 3;

  return {
    id: rencontre.id,
    gender,
    matchType,
    teamNumber,
    opponent: rencontre.club_adverse,
    location: rencontre.domicile ? 'home' : 'away',
    date,
    time,
  };
}

function GeneratePosterModal({ onClose }: { onClose: () => void }) {
  const [rencontres, setRencontres] = useState<RencontreWithContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [genStatus, setGenStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const posterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('team_rencontres')
      .select(
        `
        *,
        etape:team_etapes!etape_id(
          *,
          equipe:team_equipes!equipe_id(
            *,
            competition:team_competitions!competition_id(*)
          )
        )
      `,
      )
      .gte('date_heure', new Date().toISOString())
      .order('date_heure', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setLoadError(error.message);
        setRencontres((data ?? []) as RencontreWithContext[]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedMatches = useMemo<TeamMatch[]>(() => {
    return rencontres
      .filter((r) => selectedIds.has(r.id))
      .map((r) => {
        const equipe = r.etape?.equipe;
        const competition = equipe?.competition;
        if (!equipe || !competition) return null;
        return rencontreToTeamMatch(r, equipe, competition);
      })
      .filter((m): m is TeamMatch => m !== null);
  }, [rencontres, selectedIds]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_POSTER_MATCHES) next.add(id);
      return next;
    });
    // Une nouvelle sélection invalide l'affiche déjà générée.
    setGenStatus('idle');
    setDataUrl(null);
  };

  const handleGenerate = async () => {
    setGenStatus('loading');
    try {
      const node = posterRef.current;
      if (!node) throw new Error('Aperçu non monté');
      const url = await toJpeg(node, { quality: 0.92, pixelRatio: 2 });
      setDataUrl(url);
      setGenStatus('done');
    } catch (err) {
      console.error(err);
      setGenStatus('idle');
    }
  };

  const atMax = selectedIds.size >= MAX_POSTER_MATCHES;

  const genBtnLabel =
    genStatus === 'loading' ? 'Génération…' : genStatus === 'done' ? 'Régénérer' : "Générer l'affiche";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-2xl border bg-card p-6 shadow-xl">
        <h3 className="mb-1 text-lg font-semibold">Générer l'affiche</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Sélectionnez les rencontres à venir (max {MAX_POSTER_MATCHES}).
        </p>

        {loadError && (
          <p className="mb-3 text-sm text-red-600">Erreur de chargement : {loadError}</p>
        )}

        {loading ? (
          <div className="py-8 text-center text-muted-foreground">Chargement…</div>
        ) : rencontres.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">Aucune rencontre à venir.</div>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {rencontres.map((r) => {
              const equipe = r.etape?.equipe;
              const competition = equipe?.competition;
              const checked = selectedIds.has(r.id);
              const disabled = !checked && (atMax || !equipe || !competition);
              return (
                <label
                  key={r.id}
                  className={
                    'flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background px-3 py-2 text-sm transition ' +
                    (disabled ? 'opacity-50' : 'hover:bg-muted')
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(r.id)}
                    className="mt-0.5"
                  />
                  <span>
                    {competition && equipe ? (
                      <>
                        {competitionLabel(competition)} — Équipe {equipe.numero} · {r.club_adverse}
                      </>
                    ) : (
                      r.club_adverse
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {formatRencontreDate(r.date_heure)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {dataUrl && (
          <div className="mt-4 flex items-start gap-3.5 rounded-xl border border-dashed border-border bg-background p-3">
            <img
              src={dataUrl}
              alt="Affiche générée"
              style={{ width: 110, height: 156 }}
              className="rounded-md object-cover shadow"
            />
            <a
              href={dataUrl}
              download="affiche-matchs.jpg"
              className="text-sm font-semibold text-primary hover:underline"
            >
              Télécharger l'image
            </a>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
          >
            Fermer
          </button>
          <button
            onClick={handleGenerate}
            disabled={selectedMatches.length === 0 || genStatus === 'loading'}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95 disabled:opacity-50"
          >
            {genStatus === 'loading' && (
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            )}
            {genBtnLabel}
          </button>
        </div>
      </div>

      {/* Affiche hors viewport — requise pour html-to-image */}
      <div style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none' }} aria-hidden>
        <div ref={posterRef}>
          <TeamMatchImagePreview matches={selectedMatches} />
        </div>
      </div>
    </div>
  );
}
