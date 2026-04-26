// Carte d'un événement — badge type coloré, titre, dates, prix.
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

interface Props {
  event: ClubEvent;
}

export default function EventCard({ event }: Props) {
  const prix = !event.prix || event.prix === 0 ? 'Gratuit' : `${event.prix} €`;

  return (
    <Link to={`/evenements/${event.id}`} className="block bg-card rounded-xl overflow-hidden shadow-sm border border-border active:opacity-80 transition-opacity">
      {event.image_url && (
        <img src={event.image_url} alt={event.titre} className="w-full h-36 object-cover" />
      )}
      <div className="p-4 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TYPE_COLORS[event.type]}`}>
            {event.type}
          </span>
          <span className="text-xs text-muted-foreground ml-auto">{prix}</span>
        </div>
        <h2 className="font-semibold text-foreground text-base leading-snug">{event.titre}</h2>
        <p className="text-sm text-muted-foreground">
          {formatDate(event.date_debut)}
          {event.date_fin && ` → ${formatDate(event.date_fin)}`}
        </p>
      </div>
    </Link>
  );
}
