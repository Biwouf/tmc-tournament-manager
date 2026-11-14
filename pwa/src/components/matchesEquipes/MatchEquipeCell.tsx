import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { TeamEquipe, TeamEtape, TeamRencontre } from '../../types';
import { fromHere } from '../layout/useGoBack';

interface Props {
  rencontre: TeamRencontre;
  equipe: TeamEquipe;
  etape: TeamEtape;
  state: 'upcoming' | 'past';
  isLive: boolean;
  isPending?: boolean;
}

// Lucide `home` / `plane`, même graisse de trait : la forme et le contraste clair/foncé
// portent le lieu, pas la couleur seule.
const HOME = 'M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1h-5.5v-6h-4v6H4.5a1 1 0 0 1-1-1z';
const PLANE = 'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z';

// 0–0 hors WO = aucun résultat saisi (match nul impossible à 0 point).
function hasScore(r: TeamRencontre): boolean {
  return r.score_club != null && r.score_adverse != null && (r.wo || r.score_club + r.score_adverse > 0);
}

function outcome(r: TeamRencontre): 'win' | 'lose' | 'draw' | null {
  if (r.score_club == null || r.score_adverse == null || !hasScore(r)) return null;
  if (r.score_club > r.score_adverse) return 'win';
  if (r.score_club < r.score_adverse) return 'lose';
  return 'draw';
}

const OUTCOME_LABEL = { win: 'Victoire', lose: 'Défaite', draw: 'Nul' } as const;

const STADE_LABEL = { '1/16': 'Seizièmes', '1/8': 'Huitièmes', '1/4': 'Quarts', '1/2': 'Demies', finale: 'Finale' } as const;

function etapeLabel(etape: TeamEtape): string {
  if (etape.phase === 'poule') return etape.numero_journee ? `Journée ${etape.numero_journee}` : 'Poule';
  return etape.stade_finale ? STADE_LABEL[etape.stade_finale] : 'Phase finale';
}

/** « 9h », « 14h30 ». */
function shortTime(d: Date): string {
  const m = d.getMinutes();
  return `${d.getHours()}h${m ? String(m).padStart(2, '0') : ''}`;
}

/** « 9 heures », « 14 heures 30 » pour le lecteur d'écran. */
function spokenTime(d: Date): string {
  const m = d.getMinutes();
  return `${d.getHours()} heures${m ? ` ${m}` : ''}`;
}

// Le numéro d'équipe adverse reste collé au nom (« Club 5 » ne se coupe pas avant 5).
function opponentName(name: string): string {
  return name.replace(/\s+(\d+)$/, ' $1');
}

export default function MatchEquipeCell({ rencontre, equipe, etape, state, isLive, isPending }: Props) {
  const location = useLocation();
  const date = new Date(rencontre.date_heure);
  const away = !rencontre.domicile;
  const place = away ? 'Déplacement' : 'Au club';
  const past = state === 'past' && !isLive;
  // L'heure n'est mise en avant que lorsqu'elle sort de l'habituel 9 h.
  const unusualTime = date.getHours() !== 9 || date.getMinutes() !== 0;
  const score = rencontre.wo ? 'WO' : `${rencontre.score_club ?? 0}–${rencontre.score_adverse ?? 0}`;
  const spokenScore = rencontre.wo ? 'forfait' : `${rencontre.score_club ?? 0} à ${rencontre.score_adverse ?? 0}`;

  let trail: ReactNode = null;
  let status = '';
  if (isLive) {
    trail = <><span className="me-score block">{score}</span><span className="me-res live">En direct</span></>;
    status = `en direct, ${spokenScore}`;
  } else if (isPending || past) {
    const issue = past ? outcome(rencontre) : null;
    if (issue) {
      // En victoire notre score ressort ; en défaite c'est le leur. Pas de rouge pour une défaite.
      const us = issue === 'lose' ? 'muted' : undefined;
      const them = issue === 'win' ? 'muted' : undefined;
      trail = (
        <>
          <span className="me-score block">
            {rencontre.wo ? 'WO' : <><span className={us}>{rencontre.score_club}</span>–<span className={them}>{rencontre.score_adverse}</span></>}
          </span>
          <span className={`me-res block${issue === 'win' ? ' win' : ''}`}>{OUTCOME_LABEL[issue]}</span>
        </>
      );
      status = `${OUTCOME_LABEL[issue]}, ${spokenScore}`;
    } else if (!past && hasScore(rencontre)) {
      trail = <><span className="me-score block">{score}</span><span className="me-res block">Provisoire</span></>;
      status = `provisoire, ${spokenScore}`;
    } else {
      trail = <span className="me-pending">En attente</span>;
      status = 'résultat en attente';
    }
  }

  const label = [
    place,
    rencontre.club_adverse,
    `Équipe ${equipe.numero}`,
    past ? etapeLabel(etape) : spokenTime(date),
    status,
  ].filter(Boolean).join(', ');

  return (
    <Link
      to={`/matches-equipes/${rencontre.id}`}
      state={fromHere(location)}
      aria-label={label}
      className={`me-row${away ? ' away' : ''}`}
    >
      <span className="me-bar" aria-hidden="true" />
      <span className="me-ico">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={away ? PLANE : HOME} />
        </svg>
        <span className="sr-only">{place}</span>
      </span>
      <span className="me-mid">
        <span className="me-title block">{opponentName(rencontre.club_adverse)}</span>
        <span className="me-meta block">
          Équipe {equipe.numero} ·{' '}
          {past
            ? etapeLabel(etape)
            : <span className={`me-time${unusualTime ? ' emph' : ''}`}>{shortTime(date)}</span>}
        </span>
      </span>
      <span className="me-trail">{trail}</span>
      <span className="me-chev" aria-hidden="true" />
    </Link>
  );
}
