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
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-[10px] text-muted-foreground font-mono">sans affiche</span>
          </div>
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
