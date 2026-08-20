import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useClub } from '../../contexts/ClubContext';
import type {
  TeamCompetition,
  TeamEquipe,
  TeamEtape,
  TeamRencontre,
  TeamStadeFinale,
} from '../../types';
import { STADES_FINALE } from './teamMatchLabels';
import { currentWeekendRange, isInRange } from './weekend';
import type {
  Bilan,
  Cell,
  CellRef,
  CellState,
  Colonne,
  CompetitionBlock,
  EquipeRow,
  GridCounters,
  RencontreEntry,
} from './gridTypes';

// --- Forme brute renvoyée par le select imbriqué ---------------------------

type RawEtape = TeamEtape & { team_rencontres: TeamRencontre[] | TeamRencontre | null };
type RawEquipe = TeamEquipe & { team_etapes: RawEtape[] | null };
type RawCompetition = TeamCompetition & { team_equipes: RawEquipe[] | null };

/**
 * `team_rencontres.etape_id` est UNIQUE : une étape porte au plus une rencontre.
 * PostgREST peut néanmoins remonter un tableau selon l'inférence de relation —
 * on normalise ici, une seule fois, pas dans chaque composant.
 */
function singleRencontre(v: RawEtape['team_rencontres']): TeamRencontre | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// --- Dérivation d'état ----------------------------------------------------

const EN_DASH = '–';

/** Score `4–1` si les deux points sont saisis, sinon `null`. */
function scoreLabel(r: TeamRencontre): string | null {
  if (r.score_club === null || r.score_adverse === null) return null;
  return `${r.score_club}${EN_DASH}${r.score_adverse}`;
}

/**
 * Cascade d'état d'une cellule portant une rencontre (brief §4.2).
 * `wo` est testé AVANT les scores : un WO renseigne le score automatiquement,
 * sans quoi tous les WO gagnés s'afficheraient en `win`.
 */
function stateOfRencontre(r: TeamRencontre, now: Date): CellState {
  if (r.wo) return 'wo';
  const passee = new Date(r.date_heure).getTime() <= now.getTime();
  const scoreManquant = r.score_club === null || r.score_adverse === null;
  if (passee && scoreManquant) return 'todo';
  if (!scoreManquant) {
    if (r.score_club! > r.score_adverse!) return 'win';
    if (r.score_club! < r.score_adverse!) return 'loss';
    return 'draw';
  }
  return 'next';
}

function buildCell(colonne: Colonne, etape: TeamEtape | null, rencontre: TeamRencontre | null, now: Date, naTitle: string): Cell {
  if (!etape) {
    return { colonneKey: colonne.key, state: 'na', etape: null, rencontre: null, score: '', subtitle: '', title: naTitle };
  }
  if (!rencontre) {
    return {
      colonneKey: colonne.key,
      state: 'none',
      etape,
      rencontre: null,
      score: EN_DASH,
      subtitle: 'à programmer',
    };
  }

  const state = stateOfRencontre(rencontre, now);
  const score = scoreLabel(rencontre);
  const base = { colonneKey: colonne.key, state, etape, rencontre };

  switch (state) {
    case 'wo':
      return { ...base, score: 'WO', subtitle: score ?? rencontre.club_adverse };
    case 'todo':
      // « · · » = score manquant, à distinguer du « – » de « rien à saisir ».
      return { ...base, score: '· ·', subtitle: 'à saisir' };
    case 'draw':
      return { ...base, score: score!, subtitle: 'Nul' };
    case 'win':
    case 'loss':
      return { ...base, score: score!, subtitle: rencontre.club_adverse };
    default:
      return { ...base, score: EN_DASH, subtitle: rencontre.club_adverse };
  }
}

/** Pourquoi cette équipe n'a pas ce stade de finale (D3). */
function naTitleFinale(equipe: TeamEquipe, stade: TeamStadeFinale): string {
  if (equipe.qualifiee === false) return 'Éliminée en poule';
  if (equipe.qualifiee === null) return 'Issue de la phase de poule non renseignée';
  const depart = equipe.stade_finale_depart;
  return depart && depart !== stade
    ? `L'équipe entre en ${depart}`
    : 'Stade non programmé pour cette équipe';
}

// --- Construction d'un bloc compétition -----------------------------------

function buildBlock(competition: RawCompetition, now: Date): CompetitionBlock {
  const equipes = [...(competition.team_equipes ?? [])].sort((a, b) => a.numero - b.numero);

  // D2 — le nombre de colonnes de poule du groupe est le max des équipes.
  // `nb_journees_poule` est mutable et par équipe : on ne lui fait pas
  // aveuglément confiance, une étape J6 sur une équipe à 5 journées doit
  // s'afficher plutôt que disparaître en silence.
  let nPoule = 0;
  for (const eq of equipes) {
    const maxEtape = (eq.team_etapes ?? []).reduce(
      (m, e) => (e.phase === 'poule' ? Math.max(m, e.numero_journee ?? 0) : m),
      0
    );
    nPoule = Math.max(nPoule, eq.nb_journees_poule, maxEtape);
  }

  // D3 — union des stades réellement présents dans le groupe, ordonnée.
  // `stadesFromDepart` crée toutes les étapes d'un coup : une équipe qualifiée
  // en 1/16 en porte 5. Une colonne « Finales » unique les masquerait.
  const stadesPresents = new Set<TeamStadeFinale>();
  for (const eq of equipes) {
    for (const e of eq.team_etapes ?? []) {
      if (e.phase === 'finale' && e.stade_finale) stadesPresents.add(e.stade_finale);
    }
  }
  const stades = STADES_FINALE.filter((s) => stadesPresents.has(s));

  const colonnes: Colonne[] = [
    ...Array.from({ length: nPoule }, (_, i) => ({
      key: `J${i + 1}`,
      label: `J${i + 1}`,
      phase: 'poule' as const,
      numeroJournee: i + 1,
      stadeFinale: null,
    })),
    ...stades.map((s) => ({
      key: `F:${s}`,
      label: s === 'finale' ? 'F' : s,
      phase: 'finale' as const,
      numeroJournee: null,
      stadeFinale: s,
    })),
  ];

  const rows: EquipeRow[] = equipes.map((eq) => {
    const etapes = eq.team_etapes ?? [];
    const pouleByJournee = new Map<number, RawEtape>();
    const finaleByStade = new Map<TeamStadeFinale, RawEtape>();
    for (const e of etapes) {
      if (e.phase === 'poule' && e.numero_journee !== null) pouleByJournee.set(e.numero_journee, e);
      else if (e.phase === 'finale' && e.stade_finale) finaleByStade.set(e.stade_finale, e);
    }

    const cells = colonnes.map((col) => {
      const raw =
        col.phase === 'poule'
          ? pouleByJournee.get(col.numeroJournee!)
          : finaleByStade.get(col.stadeFinale!);
      const naTitle =
        col.phase === 'poule'
          ? `L'équipe n'a pas de journée ${col.label}`
          : naTitleFinale(eq, col.stadeFinale!);
      return buildCell(col, raw ?? null, raw ? singleRencontre(raw.team_rencontres) : null, now, naTitle);
    });

    // Bilan : compté sur les rencontres réellement scorées, WO inclus (un WO
    // porte un score de plein droit).
    const bilan: Bilan = { victoires: 0, nuls: 0, defaites: 0 };
    for (const c of cells) {
      const r = c.rencontre;
      if (!r || r.score_club === null || r.score_adverse === null) continue;
      if (r.score_club > r.score_adverse) bilan.victoires += 1;
      else if (r.score_club < r.score_adverse) bilan.defaites += 1;
      else bilan.nuls += 1;
    }

    return { equipe: eq, bilan, cells };
  });

  return { competition, colonnes, nPoule, nFinales: stades.length, equipes: rows };
}

// --- Hook -----------------------------------------------------------------

export interface TeamSeasonGrid {
  loading: boolean;
  error: string | null;
  /** Compétitions actives, dans l'ordre de création. */
  blocks: CompetitionBlock[];
  /** Compétitions marquées `terminee`. */
  doneBlocks: CompetitionBlock[];
  /** Rencontres des compétitions actives, à plat, triées par date. */
  entries: RencontreEntry[];
  /** Contexte d'une cellule, indexé par `etape.id` — toutes compétitions. */
  cellByEtapeId: Map<string, CellRef>;
  counters: GridCounters;
  reload: () => void;
}

export function useTeamSeasonGrid(saisonId: string): TeamSeasonGrid {
  const { clubId } = useClub();
  const [raw, setRaw] = useState<RawCompetition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!saisonId) return;
    let cancelled = false;
    supabase
      .from('team_competitions')
      .select('*, team_equipes(*, team_etapes(*, team_rencontres(*)))')
      // club_id est dénormalisé sur les 6 tables du module (D11) : un seul
      // filtre sur la table racine suffit.
      .eq('club_id', clubId)
      .eq('saison_id', saisonId)
      .order('created_at', { ascending: true })
      .then(({ data, error: err }) => {
        if (cancelled) return;
        setError(err?.message ?? null);
        setRaw((data ?? []) as unknown as RawCompetition[]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [saisonId, clubId, reloadKey]);

  const derived = useMemo(() => {
    const now = new Date();
    const all = raw.map((c) => buildBlock(c, now));
    const blocks = all.filter((b) => !b.competition.terminee);
    const doneBlocks = all.filter((b) => b.competition.terminee);

    const cellByEtapeId = new Map<string, CellRef>();
    for (const block of all) {
      const colByKey = new Map(block.colonnes.map((c) => [c.key, c]));
      for (const row of block.equipes) {
        for (const cell of row.cells) {
          if (!cell.etape) continue;
          cellByEtapeId.set(cell.etape.id, {
            competition: block.competition,
            equipe: row.equipe,
            etape: cell.etape,
            rencontre: cell.rencontre,
            colonne: colByKey.get(cell.colonneKey)!,
            state: cell.state,
          });
        }
      }
    }

    const entries: RencontreEntry[] = [];
    for (const block of blocks) {
      for (const row of block.equipes) {
        for (const cell of row.cells) {
          if (!cell.etape || !cell.rencontre) continue;
          entries.push({
            rencontre: cell.rencontre,
            etape: cell.etape,
            equipe: row.equipe,
            competition: block.competition,
            state: cell.state,
          });
        }
      }
    }
    entries.sort((a, b) => a.rencontre.date_heure.localeCompare(b.rencontre.date_heure));

    const weekend = currentWeekendRange(now);
    const counters: GridCounters = {
      aSaisir: entries.filter((e) => e.state === 'todo').length,
      equipesEnCours: blocks.reduce((n, b) => n + b.equipes.length, 0),
      ceWeekEnd: entries.filter(
        (e) => e.state === 'next' && isInRange(e.rencontre.date_heure, weekend)
      ).length,
    };

    return { blocks, doneBlocks, entries, cellByEtapeId, counters };
  }, [raw]);

  return { loading, error, reload, ...derived };
}
