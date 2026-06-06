import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type {
  TeamCompetition,
  TeamEquipe,
  TeamEtape,
  TeamFormat,
  TeamJoueur,
  TeamMatchGagnant,
  TeamMatchLine,
  TeamRencontre,
} from '../types';
import TeamMatchesHeader from '../components/teamMatches/TeamMatchesHeader';
import TeamMatchLineModal from '../components/teamMatches/TeamMatchLineModal';
import TeamMatchScoreModal from '../components/teamMatches/TeamMatchScoreModal';
import TeamScoreSection from '../components/teamMatches/TeamScoreSection';
import TeamPhotosSection from '../components/teamMatches/TeamPhotosSection';
import {
  competitionLabel,
  computeScore,
  etapeLabel,
  etapeLabelCourt,
  expectedMatchCount,
} from '../components/teamMatches/teamMatchLabels';

function formatDateLong(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function joueursLabel(joueurs: TeamJoueur[]): string {
  return joueurs
    .map((j) => `${j.prenom}${j.nom ? ` ${j.nom}` : ''} (${j.classement})`)
    .join(' / ');
}

interface Context {
  etape: TeamEtape;
  equipe: TeamEquipe;
  competition: TeamCompetition;
}

export default function TeamRencontrePage() {
  const { id } = useParams();

  const [rencontre, setRencontre] = useState<TeamRencontre | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [lines, setLines] = useState<TeamMatchLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editingLine, setEditingLine] = useState<TeamMatchLine | undefined>(undefined);
  const [scoringLine, setScoringLine] = useState<TeamMatchLine | undefined>(undefined);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);

    const { data: renc } = await supabase.from('team_rencontres').select('*').eq('id', id).single();
    if (!renc) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const rencRow = renc as TeamRencontre;

    const { data: etape } = await supabase
      .from('team_etapes')
      .select('*')
      .eq('id', rencRow.etape_id)
      .single();
    const { data: equipe } = etape
      ? await supabase.from('team_equipes').select('*').eq('id', (etape as TeamEtape).equipe_id).single()
      : { data: null };
    const { data: competition } = equipe
      ? await supabase
          .from('team_competitions')
          .select('*')
          .eq('id', (equipe as TeamEquipe).competition_id)
          .single()
      : { data: null };

    const { data: lineData } = await supabase
      .from('team_match_lines')
      .select('*')
      .eq('rencontre_id', rencRow.id)
      .order('ordre', { ascending: true });
    let lineRows = (lineData ?? []) as TeamMatchLine[];

    // Synchronisation depuis le Live Score (requête unique au chargement).
    if (competition) {
      lineRows = await syncFromLive(rencRow, lineRows, (competition as TeamCompetition).format);
    }

    setRencontre(rencRow);
    setContext(
      etape && equipe && competition
        ? {
            etape: etape as TeamEtape,
            equipe: equipe as TeamEquipe,
            competition: competition as TeamCompetition,
          }
        : null
    );
    setLines(lineRows);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const expected = context ? expectedMatchCount(context.competition.format) : 0;

  const handleDeleteLine = async (line: TeamMatchLine) => {
    if (line.live_match_id) return;
    if (!window.confirm('Supprimer ce match ?')) return;
    const { error } = await supabase.from('team_match_lines').delete().eq('id', line.id);
    if (error) {
      setActionError(error.message);
      return;
    }
    load();
  };

  const handleToLiveScore = async (line: TeamMatchLine) => {
    if (!rencontre || !context || line.live_match_id) return;
    setActionError(null);

    const d = new Date(rencontre.date_heure);
    const pad = (n: number) => String(n).padStart(2, '0');
    const matchDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const startTime = `${pad(d.getHours())}:${pad(d.getMinutes())}`;

    const club = line.joueurs_club;
    const adv = line.joueurs_adverse;
    const isDouble = line.match_type === 'double';

    // Mapping live_matches : équipe 1 = j1 (+ j3 en double) = notre club ;
    // équipe 2 = j2 (+ j4 en double) = club adverse.
    const payload = {
      match_date: matchDate,
      start_time: startTime,
      match_type: line.match_type,
      type_tournoi: `${context.competition.nom} — ${etapeLabelCourt(context.etape)}`,

      j1_prenom: club[0].prenom,
      j1_nom: club[0].nom ?? '',
      j1_classement: club[0].classement,
      j1_club: '',

      j2_prenom: adv[0].prenom,
      j2_nom: adv[0].nom ?? '',
      j2_classement: adv[0].classement,
      j2_club: rencontre.club_adverse,

      j3_prenom: isDouble ? club[1].prenom : null,
      j3_nom: isDouble ? club[1].nom ?? '' : null,
      j3_classement: isDouble ? club[1].classement : null,
      j3_club: isDouble ? '' : null,

      j4_prenom: isDouble ? adv[1].prenom : null,
      j4_nom: isDouble ? adv[1].nom ?? '' : null,
      j4_classement: isDouble ? adv[1].classement : null,
      j4_club: isDouble ? rencontre.club_adverse : null,

      status: 'pending' as const,
    };

    const { data, error } = await supabase.from('live_matches').insert(payload).select('id').single();
    if (error || !data) {
      setActionError(error?.message ?? 'Création du live impossible.');
      return;
    }
    const { error: updErr } = await supabase
      .from('team_match_lines')
      .update({ live_match_id: data.id })
      .eq('id', line.id);
    if (updErr) {
      setActionError(updErr.message);
      return;
    }
    load();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Chargement...
      </div>
    );
  }

  if (notFound || !rencontre) {
    return (
      <div className="min-h-screen">
        <TeamMatchesHeader title="Rencontre introuvable" backTo="/team-matches" backLabel="Matches par équipe" />
        <main className="container mx-auto px-4 py-12 text-center text-muted-foreground">
          Cette rencontre n'existe pas ou a été supprimée.
        </main>
      </div>
    );
  }

  const backTo = context ? `/team-matches/equipe/${context.equipe.id}` : '/team-matches';

  return (
    <div className="min-h-screen">
      <TeamMatchesHeader
        title={rencontre.club_adverse}
        backTo={backTo}
        backLabel="Retour à l'équipe"
        actions={
          <Link
            to={`/team-matches/rencontre/${rencontre.id}/edit`}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted"
          >
            Modifier
          </Link>
        }
      />

      <main className="container mx-auto max-w-3xl px-4 py-8 space-y-8">
        {/* Contexte */}
        {context && (
          <div className="rounded-2xl border bg-card/90 p-6 shadow-sm">
            <p className="font-medium">{competitionLabel(context.competition)}</p>
            <p className="text-sm text-muted-foreground">
              Équipe {context.equipe.numero} · {etapeLabel(context.etape)}
            </p>
            <p className="mt-2 text-sm">
              {formatDateLong(rencontre.date_heure)} · {rencontre.domicile ? 'Au club' : 'Déplacement'}
            </p>
          </div>
        )}

        {actionError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {actionError}
          </div>
        )}

        {/* Matches de la rencontre */}
        <section className="rounded-2xl border bg-card/90 p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
                Matches de la rencontre
              </h2>
              {expected > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {lines.length}/{expected} matches saisis
                </p>
              )}
            </div>
            <button
              onClick={() => {
                setEditingLine(undefined);
                setShowModal(true);
              }}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-95"
            >
              + Ajouter un match
            </button>
          </div>

          {lines.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
              Aucun match saisi.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {lines.map((line) => (
                <MatchLineRow
                  key={line.id}
                  line={line}
                  onEdit={() => {
                    setEditingLine(line);
                    setShowModal(true);
                  }}
                  onScore={() => setScoringLine(line)}
                  onDelete={() => handleDeleteLine(line)}
                  onToLive={() => handleToLiveScore(line)}
                />
              ))}
            </ul>
          )}
        </section>

        {/* Score final */}
        {context && (
          <TeamScoreSection
            rencontre={rencontre}
            lines={lines}
            format={context.competition.format}
            onSaved={load}
          />
        )}

        {/* Photos */}
        <TeamPhotosSection rencontre={rencontre} onChange={load} />
      </main>

      {showModal && (
        <TeamMatchLineModal
          rencontreId={rencontre.id}
          clubAdverse={rencontre.club_adverse}
          defaultOrdre={lines.length}
          line={editingLine}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
            load();
          }}
        />
      )}

      {scoringLine && (
        <TeamMatchScoreModal
          line={scoringLine}
          onClose={() => setScoringLine(undefined)}
          onSaved={() => {
            setScoringLine(undefined);
            load();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Synchronisation depuis le Live Score
// ============================================================

/**
 * Pour chaque match relié à un live terminé, met à jour `gagnant` puis
 * recalcule le score global. Renvoie les lignes à jour (sans re-fetch).
 */
async function syncFromLive(
  rencontre: TeamRencontre,
  lines: TeamMatchLine[],
  format: TeamFormat
): Promise<TeamMatchLine[]> {
  const liveIds = lines.map((l) => l.live_match_id).filter((x): x is string => x !== null);
  if (liveIds.length === 0) return lines;

  const { data: lives } = await supabase
    .from('live_matches')
    .select('id, status, winner')
    .in('id', liveIds);
  if (!lives) return lines;

  const liveById = Object.fromEntries(
    (lives as { id: string; status: string; winner: 'j1' | 'j2' | null }[]).map((l) => [l.id, l])
  );

  let changed = false;
  const updated = lines.map((line) => {
    if (!line.live_match_id) return line;
    const live = liveById[line.live_match_id];
    if (!live || live.status !== 'finished' || !live.winner) return line;
    const gagnant: TeamMatchGagnant = live.winner === 'j1' ? 'club' : 'adverse';
    if (line.gagnant === gagnant) return line;
    changed = true;
    return { ...line, gagnant };
  });

  if (!changed) return lines;

  // Persiste les gagnants modifiés.
  await Promise.all(
    updated
      .filter((l, i) => l.gagnant !== lines[i].gagnant)
      .map((l) => supabase.from('team_match_lines').update({ gagnant: l.gagnant }).eq('id', l.id))
  );

  // Recalcule et persiste le score global.
  const { club, adverse } = computeScore(updated, format);
  await supabase
    .from('team_rencontres')
    .update({ score_club: club, score_adverse: adverse })
    .eq('id', rencontre.id);

  return updated;
}

// ============================================================
// Ligne d'un match individuel
// ============================================================

function MatchLineRow({
  line,
  onEdit,
  onScore,
  onDelete,
  onToLive,
}: {
  line: TeamMatchLine;
  onEdit: () => void;
  onScore: () => void;
  onDelete: () => void;
  onToLive: () => void;
}) {
  const hasLive = line.live_match_id !== null;

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium capitalize text-muted-foreground">
        {line.match_type}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-medium">{joueursLabel(line.joueurs_club)}</span>
          <span className="text-muted-foreground"> vs </span>
          {joueursLabel(line.joueurs_adverse)}
        </p>
        {(line.gagnant || line.score) && (
          <p className="text-xs font-medium text-emerald-700">
            {line.gagnant && `Vainqueur : ${line.gagnant === 'club' ? 'notre club' : 'adverse'}`}
            {line.gagnant && line.score && ' · '}
            {line.score && <span className="font-normal text-muted-foreground">{line.score}</span>}
          </p>
        )}
      </div>

      {hasLive ? (
        <Link
          to={`/live-score/${line.live_match_id}`}
          className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 transition hover:bg-red-200"
        >
          {line.gagnant ? 'Terminé · voir le live' : 'En live'}
        </Link>
      ) : line.gagnant ? (
        <button
          onClick={onScore}
          title="Cliquer pour modifier le résultat"
          className="rounded-full bg-emerald-100 px-3 py-0.5 text-xs font-medium text-emerald-800 transition hover:bg-emerald-200"
        >
          Terminé
        </button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onScore}
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100"
          >
            Saisir le score
          </button>
          <button
            onClick={onToLive}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted"
          >
            → Live Score
          </button>
          <button
            onClick={onEdit}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted"
          >
            Modifier
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100"
          >
            Supprimer
          </button>
        </div>
      )}
    </li>
  );
}
