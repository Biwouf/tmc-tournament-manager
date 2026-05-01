// Carte d'un événement — vignette latérale + date renforcée (variante B1).
// Clic → navigation vers /evenements/:id

import { Link } from 'react-router-dom';
import type { ClubEvent, EventType } from '../../types';

const TYPE_COLORS: Record<EventType, string> = {
  Animation:          'bg-blue-100 text-blue-700',
  Tournoi:            'bg-purple-100 text-purple-700',
  'Match par équipe': 'bg-green-100 text-green-700',
  Sortie:             'bg-orange-100 text-orange-700',
  Soirée:             'bg-pink-100 text-pink-700',
};

const TYPE_TONES: Record<EventType, { bg: string; text: string }> = {
  Animation:          { bg: 'bg-blue-100',   text: 'text-blue-900'   },
  Tournoi:            { bg: 'bg-purple-100', text: 'text-purple-900' },
  'Match par équipe': { bg: 'bg-green-100',  text: 'text-green-900'  },
  Sortie:             { bg: 'bg-orange-100', text: 'text-orange-900' },
  Soirée:             { bg: 'bg-pink-100',   text: 'text-pink-900'   },
};

function formatPosterDate(dateISO: string): { weekday: string; jour: string; mois: string } {
  const d = new Date(dateISO);
  const weekday = d
    .toLocaleDateString('fr-FR', { weekday: 'short' })
    .replace('.', '')
    .toUpperCase();
  const jour = d.toLocaleDateString('fr-FR', { day: '2-digit' });
  const mois = d
    .toLocaleDateString('fr-FR', { month: 'short' })
    .replace('.', '')
    .toUpperCase();
  return { weekday, jour, mois };
}

function EventPosterPlaceholder({ event }: { event: ClubEvent }) {
  const { weekday, jour, mois } = formatPosterDate(event.date_debut);
  const tone = TYPE_TONES[event.type];
  return (
    <div className={`w-full h-full flex flex-col items-center justify-center gap-0.5 ${tone.bg} ${tone.text}`}>
      <span className="text-[10px] font-bold tracking-[0.12em] opacity-70">{weekday}</span>
      <span className="text-[38px] font-extrabold leading-[0.9] tracking-tight">{jour}</span>
      <span className="text-[11px] font-bold tracking-[0.12em]">{mois}</span>
    </div>
  );
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function formatDate(event: ClubEvent): string {
  const debut = new Date(event.date_debut);
  const fin = event.date_fin ? new Date(event.date_fin) : null;

  const sameDay =
    fin !== null &&
    debut.getFullYear() === fin.getFullYear() &&
    debut.getMonth() === fin.getMonth() &&
    debut.getDate() === fin.getDate();

  if (!fin || sameDay) {
    return capitalize(
      debut.toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    );
  }

  const sameMonth =
    debut.getFullYear() === fin.getFullYear() &&
    debut.getMonth() === fin.getMonth();
  if (sameMonth) {
    const mois = debut.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    return `Du ${debut.getDate()} au ${fin.getDate()} ${mois}`;
  }

  const debutFmt = debut.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const finFmt = fin.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  return `Du ${debutFmt} au ${finFmt}`;
}

interface Props {
  event: ClubEvent;
}

export default function EventCard({ event }: Props) {
  const prix = !event.prix || event.prix === 0 ? 'Gratuit' : `${event.prix} €`;

  return (
    <Link
      to={`/evenements/${event.id}`}
      className="flex h-[130px] bg-card rounded-xl overflow-hidden border border-border shadow-sm active:opacity-80 transition-opacity"
    >
      <div className="w-24 flex-shrink-0 bg-muted">
        {event.image_url ? (
          <img
            src={event.image_url}
            alt={event.titre}
            className="w-full h-full object-cover block"
          />
        ) : (
          <EventPosterPlaceholder event={event} />
        )}
      </div>

      <div className="flex-1 min-w-0 p-3 flex flex-col gap-1.5">
        <p className="text-[13px] font-extrabold text-primary tracking-tight">
          {formatDate(event)}
        </p>
        <h2 className="text-sm font-bold text-foreground leading-snug line-clamp-2">{event.titre}</h2>
        <div className="flex items-center gap-2 mt-auto">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TYPE_COLORS[event.type]}`}>
            {event.type}
          </span>
          <span className="ml-auto text-[11px] text-muted-foreground">{prix}</span>
        </div>
      </div>
    </Link>
  );
}
