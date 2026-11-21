// Faits envoyés à Claude pour préparer une interview d'après-match (Edge Function
// generate-interview, docs/specs/INTERVIEWS.md). Entrée : les faits bruts renvoyés par la RPC
// interview_gen_begin. Tout ce qui est calculable l'est ici, en code (score du point de vue du
// joueur, moment fort, breaks, série, face-à-face) : le modèle n'a qu'à rédiger.
//
// Minimisation : prénoms seuls (joueur, partenaire, adversaires), classements, aucun identifiant.

import { matchHighlight, recapSets, replayFrames } from './liveRecapCore.ts';
import type { RecapMatch, RecapSnapshot, Side } from './liveRecapCore.ts';
import { TENNIS_RANKINGS } from './tennisRankings.ts';
import { firstName } from './teamPostFacts.mjs';

type Player = { prenom?: string | null; nom?: string | null; classement?: string | null } | null;
type PastLive = RecapMatch & {
  source: 'live';
  date: string;
  side: string;
  match_type: 'simple' | 'double';
  j1: Player; j2: Player; j3: Player; j4: Player;
};
type PastTeam = {
  source: 'team';
  date: string;
  match_type: 'simple' | 'double';
  joueurs_adverse: Player[];
  score: string | null;
  gagnant: 'club' | 'adverse';
  result_kind: string | null;
  club_adverse: string | null;
};
export type RawInterviewFacts = {
  side: string;
  player: { prenom: string; nom: string } | null;
  match: PastLive & {
    court: string | null;
    started_at: string | null;
    set1_ended_at: string | null;
    set2_ended_at: string | null;
  };
  recap: {
    messages: number;
    photos: number;
    reactions: number;
    viewers: number | null;
    score: RecapSnapshot[];
  } | null;
  event: { titre: string } | null;
  team: {
    club_adverse: string | null;
    score_club: number | null;
    score_adverse: number | null;
    competition: string | null;
    equipe: number | null;
  } | null;
  history: PastLive[];
  team_history: PastTeam[];
  previous_interviews: {
    date: string;
    opponent: string;
    questions: { id: string; texte: string }[];
    answers: { question_id: string; texte: string }[];
  }[];
};

const teamOf = (side: string): Side => (side === 'j1' || side === 'j3' ? 'j1' : 'j2');
const other = (team: Side): Side => (team === 'j1' ? 'j2' : 'j1');
const rank = (value: string | null | undefined) =>
  TENNIS_RANKINGS.indexOf((value ?? '').trim() as (typeof TENNIS_RANKINGS)[number]);
/** Prénom seul (un prénom Ten'Up « Jean DUPONT » perd son nom en capitales). */
const prenom = (p: Player) => (p ? firstName({ prenom: p.prenom || p.nom || '' }) : '');
const players = (m: PastLive, team: Side): Player[] =>
  (team === 'j1' ? [m.j1, m.j3] : [m.j2, m.j4]).filter((p): p is NonNullable<Player> => !!p && !!(p.prenom || p.nom));

/** Clé de nom identique à live_name_key (SQL) : minuscules, sans accents, [a-z0-9] seulement. */
export function nameKey(p: Player) {
  return `${p?.prenom ?? ''}${p?.nom ?? ''}`
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
const opponentsKey = (list: Player[]) => list.map(nameKey).sort().join('|');

/** Sets du point de vue de `team` : « 6-4 », « 7-6 (5) », super tie-break « 10-8 ». */
function setScores(m: RecapMatch, team: Side) {
  return recapSets(m, []).map(s => {
    const [a, b] = team === 'j1' ? s.score : [s.score[1], s.score[0]];
    const tb = s.tiebreak ? Math.min(...s.tiebreak) : null;
    return `${a}-${b}${tb !== null ? ` (${tb})` : ''}`;
  });
}

function outcome(m: RecapMatch, team: Side) {
  if (!m.winner) return 'non conclu';
  return m.winner === team ? 'victoire' : 'défaite';
}

function minutes(from: string | null | undefined, to: string | null | undefined) {
  if (!from || !to) return null;
  const n = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null
    : new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long' }).format(d);
};

type Result = { date: string; resultat: string; score: string; adversaires: string[]; type: string; key: string | null };

function pastLive(m: PastLive): Result {
  const team = teamOf(m.side);
  return {
    date: m.date,
    resultat: outcome(m, team) + (m.retired_player ? ' (abandon)' : ''),
    score: setScores(m, team).join(' '),
    adversaires: players(m, other(team)).map(prenom),
    type: m.match_type,
    key: opponentsKey(players(m, other(team))),
  };
}

function pastTeam(t: PastTeam): Result {
  return {
    date: t.date,
    resultat: (t.gagnant === 'club' ? 'victoire' : 'défaite') + (t.result_kind === 'wo' ? ' (forfait)' : ''),
    score: t.score ?? '',
    adversaires: (t.joueurs_adverse ?? []).map(prenom).filter(Boolean),
    type: t.match_type,
    key: opponentsKey(t.joueurs_adverse ?? []),
  };
}

export function buildInterviewFacts(raw: RawInterviewFacts) {
  const m = raw.match;
  const team = teamOf(raw.side);
  const mine = players(m, team);
  const theirs = players(m, other(team));
  const me = mine.find(p => nameKey(p) === nameKey(m[raw.side as 'j1'])) ?? mine[0] ?? null;
  const partner = m.match_type === 'double' ? mine.find(p => p !== me) ?? null : null;
  const snapshots = raw.recap?.score ?? [];
  const sets = recapSets(m, snapshots);
  const nameOf = (side: Side) => (side === team ? prenom(me) : theirs.map(prenom).join(' et '));
  const highlight = matchHighlight(m, sets, nameOf);
  const frames = replayFrames(m, snapshots);
  const breaks = m.first_server && frames.some(f => f.game)
    ? frames.reduce((acc, f) => {
        if (f.game?.isBreak) acc[f.game.side === team ? 'pour' : 'contre']++;
        return acc;
      }, { pour: 0, contre: 0 })
    : null;
  const myRank = rank(me?.classement);
  const bestOpponent = Math.max(...theirs.map(p => rank(p.classement)));
  const perf = m.winner === team && m.match_type === 'simple' && myRank >= 0 && bestOpponent > myRank;

  const past = [...(raw.history ?? []).map(pastLive), ...(raw.team_history ?? []).map(pastTeam)]
    .sort((a, b) => b.date.localeCompare(a.date));
  const recent = past.slice(0, 5);
  let streak = 0;
  const current = outcome(m, team);
  if (current === 'victoire' || current === 'défaite') {
    for (const r of past) {
      if (!r.resultat.startsWith(current)) break;
      streak++;
    }
  }
  const key = opponentsKey(theirs);
  const headToHead = past.filter(r => r.key === key);

  return {
    joueur: prenom(me ?? raw.player),
    match: {
      type: m.match_type,
      partenaire: partner ? prenom(partner) : null,
      adversaires: theirs.map(p => ({ prenom: prenom(p), classement: p.classement || null })),
      classement_joueur: me?.classement || null,
      resultat: current,
      abandon: m.retired_player ? (m.retired_player === team ? 'le joueur a abandonné' : 'l’adversaire a abandonné') : null,
      score: setScores(m, team),
      perf,
      duree_minutes: minutes(m.started_at, m.finished_at),
      moment_fort: highlight ? `${highlight.title} (${highlight.detail})` : null,
      breaks,
      court: m.court || null,
    },
    cadre: raw.team
      ? {
          type: 'rencontre par équipes',
          competition: raw.team.competition,
          equipe: raw.team.equipe,
          adversaire: raw.team.club_adverse,
          score_rencontre: raw.team.score_club !== null && raw.team.score_adverse !== null
            ? `${raw.team.score_club}-${raw.team.score_adverse}` : null,
        }
      : raw.event ? { type: 'tournoi', nom: raw.event.titre } : null,
    ambiance: raw.recap
      ? { spectateurs: raw.recap.viewers, messages: raw.recap.messages, photos: raw.recap.photos, reactions: raw.recap.reactions }
      : null,
    historique: recent.map(r => ({ date: day(r.date), resultat: r.resultat, score: r.score, contre: r.adversaires, type: r.type })),
    serie: streak >= 2 ? `${streak + 1} ${current === 'victoire' ? 'victoires' : 'défaites'} de suite` : null,
    face_a_face: headToHead.map(r => ({ date: day(r.date), resultat: r.resultat, score: r.score })),
    interviews_precedentes: (raw.previous_interviews ?? []).map(p => ({
      date: day(p.date),
      contre: p.opponent.split(' / ').map(n => firstName({ prenom: n.split(' ')[0] })).join(' et '),
      echanges: p.questions
        .map(q => ({ question: q.texte, reponse: p.answers.find(a => a.question_id === q.id)?.texte ?? '' }))
        .filter(e => e.reponse),
    })),
  };
}
